/**
 * Dumps the Better Auth schema (SQLite) for the D1 migration.
 * Run: node scripts/auth/schema.mjs
 */
import { getAuthTables } from "@better-auth/core/db";
import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";

const auth = betterAuth({
  appName: "DYNAMIC",
  baseURL: "http://localhost:5174",
  secret: "schema-dump-only",
  database: { dialect: new D1Dialect({ database: {} }), type: "sqlite" },
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  session: { expiresIn: 604800, updateAge: 86400 },
  advanced: { cookiePrefix: "dynamic", useSecureCookies: true },
});

const tables = getAuthTables(auth.options);
const summary = {};
for (const [name, table] of Object.entries(tables)) {
  summary[name] = Object.entries(table.fields).map(
    ([key, field]) =>
      `${key}:${field.type ?? "string"}${field.required ? "!" : ""}${field.unique ? " U" : ""}`,
  );
}
console.log(JSON.stringify(summary, null, 2));
