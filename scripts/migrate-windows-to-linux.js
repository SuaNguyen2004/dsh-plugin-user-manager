import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Migration Script: Windows DSH Multi-User Data to Linux Docker Container
 *
 * Supported flags:
 *   --dry-run        Simulate and output plan without modifying files
 *   --apply          Apply migration changes in-place
 *   --data-dir <dir> Target root directory containing db/, dsh_home/, workspaces/
 *   --verbose        Print verbose diagnostic information
 */

export function parseArgs(args = process.argv.slice(2)) {
    let isDryRun = true;
    let dataDir = path.resolve(process.cwd(), "test-cloned-migration-data");
    let verbose = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--dry-run") {
            isDryRun = true;
        } else if (arg === "--apply") {
            isDryRun = false;
        } else if (arg === "--verbose") {
            verbose = true;
        } else if (arg === "--data-dir" && args[i + 1]) {
            dataDir = path.resolve(args[++i]);
        } else if (arg.startsWith("--data-dir=")) {
            dataDir = path.resolve(arg.slice("--data-dir=".length));
        }
    }

    return { isDryRun, dataDir, verbose };
}

export function normalizeToLinuxPath(winPath) {
    if (!winPath) return winPath;
    return winPath.replace(/\\/g, "/");
}

export function migrateData(options = {}) {
    const {
        dataDir = path.resolve(process.cwd(), "test-cloned-migration-data"),
        isDryRun = true,
        verbose = false,
    } = options;

    const manifest = {
        mode: isDryRun ? "DRY-RUN" : "APPLY",
        dataDir,
        timestamp: new Date().toISOString(),
        changes: [],
        skipped: [],
        summary: {
            dbUsersUpdated: 0,
            dbAttachmentsUpdated: 0,
            workspacesUpdated: 0,
            sessionDirsRenamed: 0,
            sessionCwdUpdated: 0,
            cordisPatched: false,
            totalChanges: 0,
        },
    };

    const dbPath = path.join(dataDir, "db", "users.db");
    const dshHome = path.join(dataDir, "dsh_home");
    const workspacesRoot = path.join(dataDir, "workspaces");

    // =========================================================================
    // 1. MIGRATE SQLITE DATABASE (users.db)
    // =========================================================================
    if (fs.existsSync(dbPath)) {
        // Open DB in read-only mode for dry-run or read-write for apply
        const db = new DatabaseSync(dbPath, { readOnly: isDryRun });

        try {
            // 1.1 Migrate users table: workspace_path -> /data/workspaces/<username>
            const users = db.prepare("SELECT id, username, workspace_path FROM users").all();
            for (const u of users) {
                const curPath = u.workspace_path || "";
                const targetPath = `/data/workspaces/${u.username}`;

                if (curPath !== targetPath) {
                    manifest.changes.push({
                        type: "SQLITE_USER_WORKSPACE",
                        userId: u.id,
                        username: u.username,
                        from: curPath,
                        to: targetPath,
                    });
                    manifest.summary.dbUsersUpdated++;

                    if (!isDryRun) {
                        db.prepare("UPDATE users SET workspace_path = ? WHERE id = ?").run(targetPath, u.id);
                    }
                } else {
                    manifest.skipped.push({
                        type: "SQLITE_USER_WORKSPACE",
                        userId: u.id,
                        username: u.username,
                        reason: "Already normalized",
                    });
                }
            }

            // 1.2 Migrate attachments table: file_path -> /data/dsh_home/attachments/...
            const attachments = db.prepare("SELECT id, attachment_id, file_path FROM attachments").all();
            for (const a of attachments) {
                const curPath = a.file_path || "";
                const norm = normalizeToLinuxPath(curPath);

                // Pattern: .../attachments/(.*) -> /data/dsh_home/attachments/$1
                const attMatch = norm.match(/attachments\/(.+)$/i);
                if (attMatch) {
                    const targetPath = `/data/dsh_home/attachments/${attMatch[1]}`;
                    if (curPath !== targetPath) {
                        manifest.changes.push({
                            type: "SQLITE_ATTACHMENT_PATH",
                            attachmentDbId: a.id,
                            attachmentId: a.attachment_id,
                            from: curPath,
                            to: targetPath,
                        });
                        manifest.summary.dbAttachmentsUpdated++;

                        if (!isDryRun) {
                            db.prepare("UPDATE attachments SET file_path = ? WHERE id = ?").run(targetPath, a.id);
                        }
                    } else {
                        manifest.skipped.push({
                            type: "SQLITE_ATTACHMENT_PATH",
                            attachmentDbId: a.id,
                            reason: "Already normalized",
                        });
                    }
                }
            }
        } finally {
            db.close();
        }
    }

    // =========================================================================
    // 2. MIGRATE storages/workspace.json
    // =========================================================================
    const wsJsonPath = path.join(dshHome, "storages", "workspace.json");
    if (fs.existsSync(wsJsonPath)) {
        const raw = fs.readFileSync(wsJsonPath, "utf8");
        let wsData;
        try {
            wsData = JSON.parse(raw);
        } catch (e) {
            console.error("Error parsing workspace.json:", e.message);
        }

        if (wsData && wsData.tables && wsData.tables.workspaces) {
            let wsModified = false;
            const workspaces = wsData.tables.workspaces;

            for (const [wsId, wsObj] of Object.entries(workspaces)) {
                const curPath = wsObj.path || "";
                const norm = normalizeToLinuxPath(curPath);

                // Extract username from workspace path (e.g. .../workspaces/admin or wsId user-workspace-admin)
                let username = null;
                const matchWs = norm.match(/workspaces\/([^/]+)$/i);
                if (matchWs) {
                    username = matchWs[1];
                } else if (wsId.startsWith("user-workspace-")) {
                    username = wsId.replace("user-workspace-", "");
                }

                if (username) {
                    const targetPath = `/data/workspaces/${username}`;
                    if (curPath !== targetPath) {
                        manifest.changes.push({
                            type: "WORKSPACE_JSON_PATH",
                            workspaceId: wsId,
                            from: curPath,
                            to: targetPath,
                        });
                        manifest.summary.workspacesUpdated++;
                        wsObj.path = targetPath;
                        wsModified = true;
                    } else {
                        manifest.skipped.push({
                            type: "WORKSPACE_JSON_PATH",
                            workspaceId: wsId,
                            reason: "Already normalized",
                        });
                    }
                }
            }

            if (wsModified && !isDryRun) {
                fs.writeFileSync(wsJsonPath, JSON.stringify(wsData, null, 2), "utf8");
            }
        }
    }

    // =========================================================================
    // 3. MIGRATE sessions/ DIRECTORIES
    // =========================================================================
    const sessionsDir = path.join(dshHome, "sessions");
    if (fs.existsSync(sessionsDir)) {
        const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
        for (const ent of entries) {
            if (ent.isDirectory()) {
                const oldName = ent.name;

                // Windows format: --C-Users-Admin-Desktop-User~0020Management-workspaces-<username>--
                // or general: --.*-workspaces-(.+)--
                const match = oldName.match(/--.*-workspaces-(.+)--$/i);
                if (match) {
                    const username = match[1];
                    const newName = `--data-workspaces-${username}--`;

                    if (oldName !== newName) {
                        manifest.changes.push({
                            type: "SESSION_DIR_RENAME",
                            from: oldName,
                            to: newName,
                        });
                        manifest.summary.sessionDirsRenamed++;

                        if (!isDryRun) {
                            const oldFullPath = path.join(sessionsDir, oldName);
                            const newFullPath = path.join(sessionsDir, newName);

                            if (fs.existsSync(newFullPath)) {
                                // If destination exists, merge contents
                                const subFiles = fs.readdirSync(oldFullPath);
                                for (const sf of subFiles) {
                                    const srcSub = path.join(oldFullPath, sf);
                                    const dstSub = path.join(newFullPath, sf);
                                    if (!fs.existsSync(dstSub)) {
                                        fs.renameSync(srcSub, dstSub);
                                    }
                                }
                                fs.rmSync(oldFullPath, { recursive: true, force: true });
                            } else {
                                fs.renameSync(oldFullPath, newFullPath);
                            }
                        }
                    }
                }
            }
        }
    }

    // =========================================================================
    // 4. MIGRATE storages/session_projcache/sessions/*.json
    // =========================================================================
    const projCacheDir = path.join(dshHome, "storages", "session_projcache", "sessions");
    if (fs.existsSync(projCacheDir)) {
        const sessionFiles = fs.readdirSync(projCacheDir).filter((f) => f.endsWith(".json"));
        for (const sFile of sessionFiles) {
            const sFilePath = path.join(projCacheDir, sFile);
            try {
                const raw = fs.readFileSync(sFilePath, "utf8");
                const sData = JSON.parse(raw);
                const curCwd = sData.record?.identity?.cwd || "";
                const normCwd = normalizeToLinuxPath(curCwd);

                const matchCwd = normCwd.match(/workspaces\/([^/]+)$/i);
                if (matchCwd) {
                    const username = matchCwd[1];
                    const targetCwd = `/data/workspaces/${username}`;

                    if (curCwd !== targetCwd) {
                        manifest.changes.push({
                            type: "SESSION_PROJCACHE_CWD",
                            sessionFile: sFile,
                            from: curCwd,
                            to: targetCwd,
                        });
                        manifest.summary.sessionCwdUpdated++;

                        if (!isDryRun) {
                            sData.record.identity.cwd = targetCwd;
                            fs.writeFileSync(sFilePath, JSON.stringify(sData, null, 2), "utf8");
                        }
                    }
                }
            } catch (err) {
                if (verbose) console.warn(`Warning parsing ${sFile}:`, err.message);
            }
        }
    }

    // =========================================================================
    // 5. ENSURE profiles/web/cordis.patch.yml & CLEAN OLD WINDOWS JUNCTION
    // =========================================================================
    const cordisPatchPath = path.join(dshHome, "profiles", "web", "cordis.patch.yml");
    if (fs.existsSync(cordisPatchPath)) {
        let content = fs.readFileSync(cordisPatchPath, "utf8");

        // Ensure webserver entry with host 0.0.0.0
        if (!content.includes("id: webserver")) {
            const webserverPatch = `- id: webserver\n  config:\n    host: 0.0.0.0\n    port: !!js ctx.webStartup.port ?? 3090\n\n`;
            content = webserverPatch + content;
            manifest.changes.push({
                type: "CORDIS_PATCH_WEBSERVER",
                description: "Prepended webserver config (host: 0.0.0.0, port fallback 3090)",
            });
            manifest.summary.cordisPatched = true;

            if (!isDryRun) {
                fs.writeFileSync(cordisPatchPath, content, "utf8");
            }
        }
    }

    // Clean old Windows node_modules symlink if broken or junction
    const profilePluginLink = path.join(dshHome, "profiles", "web", "node_modules", "dsh-plugin-user-manager");
    if (fs.existsSync(profilePluginLink) || fs.lstatSync(profilePluginLink, { throwIfNoEntry: false })) {
        if (!isDryRun) {
            try {
                fs.rmSync(profilePluginLink, { recursive: true, force: true });
                manifest.changes.push({
                    type: "CLEAN_PROFILE_PLUGIN_LINK",
                    description: "Removed legacy Windows plugin link to allow docker-entrypoint to recreate Linux link",
                });
            } catch (_) {}
        }
    }

    manifest.summary.totalChanges = manifest.changes.length;
    return manifest;
}

// Direct execution CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    const { isDryRun, dataDir, verbose } = parseArgs();
    console.log("================================================================");
    console.log(`DSH MULTI-USER MIGRATION UTILITY [${isDryRun ? "DRY-RUN" : "APPLY"}]`);
    console.log(`Target directory: ${dataDir}`);
    console.log("================================================================\n");

    const result = migrateData({ dataDir, isDryRun, verbose });

    console.log("SUMMARY OF CHANGES:");
    console.log(`- SQLite Users updated:           ${result.summary.dbUsersUpdated}`);
    console.log(`- SQLite Attachments updated:     ${result.summary.dbAttachmentsUpdated}`);
    console.log(`- Workspaces updated in json:     ${result.summary.workspacesUpdated}`);
    console.log(`- Session directories renamed:    ${result.summary.sessionDirsRenamed}`);
    console.log(`- Session projcache CWD updated:  ${result.summary.sessionCwdUpdated}`);
    console.log(`- Cordis webserver patched:       ${result.summary.cordisPatched}`);
    console.log(`- Total changes:                  ${result.summary.totalChanges}`);
    console.log(`- Total skipped (already valid):  ${result.skipped.length}`);

    if (verbose && result.changes.length > 0) {
        console.log("\nDETAILS OF CHANGES:");
        result.changes.forEach((c, idx) => {
            console.log(`  ${idx + 1}. [${c.type}] ${c.from || ""} -> ${c.to || c.description || ""}`);
        });
    }

    console.log("\nMigration run completed successfully.");
}
