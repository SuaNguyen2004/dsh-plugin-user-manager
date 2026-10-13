import assert from "node:assert";
import { getNativeInjectionMarkup } from "../../lib/ui/ui-injection.js";

console.log("--- TEST: Syntax Validation for Injected Native UI Script ---");

const markup = getNativeInjectionMarkup();
assert(markup.includes("<script>"), "Markup must contain <script> tag");
assert(markup.includes("</script>"), "Markup must contain </script> tag");

const scriptMatch = markup.match(/<script>([\s\S]*?)<\/script>/);
assert(scriptMatch && scriptMatch[1], "Must extract JavaScript from <script> tag");

const code = scriptMatch[1];
console.log(`Injected script size: ${code.length} characters.`);

// Verify syntax by instantiating new Function
try {
    new Function(code);
    console.log(
        "✅ PASS: Injected script has 100% valid JavaScript syntax. No unescaped quotes or runtime parse errors.",
    );
} catch (e) {
    console.error("❌ SYNTAX ERROR DETECTED IN INJECTED SCRIPT:", e.message);
    throw e;
}
