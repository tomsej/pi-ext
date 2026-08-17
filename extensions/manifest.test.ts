import { expect, test } from "bun:test";
import packageJson from "../package.json";

const extensions = packageJson.pi.extensions;

test("removed extensions are not shipped by pi-ext", () => {
	expect(extensions).not.toContain("./extensions/permissions/permissions.ts");
	expect(extensions).not.toContain("./extensions/session-query/index.ts");
});
