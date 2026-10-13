import { spawnSync } from "node:child_process";

const testSuites = [
    "test/unit/test-auth.js",
    "test/unit/test-workspace.js",
    "test/unit/test-model-guard.js",
    "test/unit/test-native-approval.js",
    "test/unit/test-security-isolation.js",
    "test/unit/test-document-v2.js",
];

console.log("====================================================");
console.log("   RUNNING TEST SUITE (DSH USER MANAGER)            ");
console.log("====================================================\n");

for (const testFile of testSuites) {
    console.log(`\n▶ [RUNNING] ${testFile}...`);
    const result = spawnSync("node", [testFile], {
        stdio: "inherit",
        shell: true,
    });

    if (result.status !== 0) {
        console.error(`❌ [FAILED] ${testFile} (Exit code: ${result.status})`);
        process.exit(result.status);
    } else {
        console.log(`✅ [PASSED] ${testFile}`);
    }
}

console.log("\n====================================================");
console.log("🎉 ALL TESTS COMPLETED SUCCESSFULLY!                ");
console.log("====================================================\n");
