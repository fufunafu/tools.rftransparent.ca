import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
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
const uploadExportOptions = resolve(root, "ios/App/ExportOptions.plist");

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
  const localExport = process.env.IOS_UPLOAD_TESTFLIGHT !== "1";
  let exportOptions = uploadExportOptions;
  if (localExport) {
    // Keep a local export local. The committed App Store Connect options use
    // destination=upload for the explicit TestFlight command, so derive a
    // temporary export-only plist instead of risking an unintended upload.
    exportOptions = resolve(archiveRoot, "ExportOptions.local.plist");
    copyFileSync(uploadExportOptions, exportOptions);
    run("/usr/bin/plutil", [
      "-replace", "destination", "-string", "export", exportOptions,
    ]);
  }
  run("/usr/bin/xcodebuild", [
    "-exportArchive",
    "-archivePath", archivePath,
    "-exportPath", exportPath,
    "-exportOptionsPlist", exportOptions,
    "-allowProvisioningUpdates",
  ]);
  if (localExport) {
    run(process.execPath, [
      "scripts/validate-ios-export.mjs",
      exportPath,
      archivePath,
    ]);
  }
}

console.log(`iOS archive created at ${archivePath}`);
if (process.env.IOS_EXPORT_ARCHIVE === "1" && process.env.IOS_UPLOAD_TESTFLIGHT !== "1") {
  console.log(`iOS App Store export created at ${exportPath}`);
}
