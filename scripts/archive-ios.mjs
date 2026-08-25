import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const archiveRun = new Date().toISOString().replace(/[:.]/g, "-");
// Keep the unsigned build products and the archive outside FileProvider-backed
// workspaces such as iCloud Drive. Finder metadata added to an .app while
// Xcode is assembling it invalidates device code signing before the archive
// can be created. Callers that have a local, non-FileProvider artifact volume
// can select it explicitly with IOS_ARCHIVE_ROOT.
const archiveBase = process.env.IOS_ARCHIVE_ROOT
  ? resolve(process.env.IOS_ARCHIVE_ROOT)
  : resolve(process.env.RUNNER_TEMP ?? tmpdir(), "rf-tools-ios-archives");
const archiveRoot = resolve(archiveBase, archiveRun);
const archivePath = resolve(archiveRoot, "RFTools.xcarchive");
const exportPath = resolve(archiveRoot, "export");

mkdirSync(archiveRoot, { recursive: true });

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env });
}

run("npm", ["run", "cap:sync:prod"]);
run("xcodegen", ["generate", "--spec", "project.yml"], resolve(root, "ios/App"));
run("npm", ["run", "ios:validate-release"]);
run("/usr/bin/xcodebuild", [
  "-project", "ios/App/App.xcodeproj",
  "-scheme", "App",
  "-configuration", "Release",
  "-destination", "generic/platform=iOS",
  "-archivePath", archivePath,
  "-allowProvisioningUpdates",
  "archive",
]);

if (process.env.IOS_EXPORT_ARCHIVE === "1" || process.env.IOS_UPLOAD_TESTFLIGHT === "1") {
  run("/usr/bin/xcodebuild", [
    "-exportArchive",
    "-archivePath", archivePath,
    "-exportPath", exportPath,
    "-exportOptionsPlist", "ios/App/ExportOptions.plist",
    "-allowProvisioningUpdates",
  ]);
}

console.log(`iOS archive created at ${archivePath}`);
