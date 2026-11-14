const Database = require("better-sqlite3");

const db = new Database(
    "E:/Student Management v9.3-Railway-Test/db/institution.db",
    { readonly: true, fileMustExist: true }
);

try {
    console.log("Integrity check:", db.pragma("integrity_check", { simple: true }));

    const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    console.log("Tables found:", tables.length);
    console.log(tables.map(t => t.name).join("\n"));
} finally {
    db.close();
}
