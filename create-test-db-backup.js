const Database = require("better-sqlite3");

const sourcePath = "E:/Student Management v9.3/db/institution.db";
const targetPath = "E:/Student Management v9.3-Railway-Test/db/institution.db";

(async () => {
    const source = new Database(sourcePath, {
        readonly: true,
        fileMustExist: true
    });

    try {
        await source.backup(targetPath);
        console.log("Backup completed successfully.");
    } finally {
        source.close();
    }
})().catch(error => {
    console.error("Backup failed:", error);
    process.exit(1);
});
