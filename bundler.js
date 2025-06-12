const fs = require("fs");
const path = require("path");

// --- AANPASSING HIER ---
// Probeer de writeSync functie direct van de .default export te halen
let writeSyncFunction;
try {
  const clipboardyModule = require("clipboardy");
  if (clipboardyModule.default && typeof clipboardyModule.default.writeSync === "function") {
    writeSyncFunction = clipboardyModule.default.writeSync;
  } else if (typeof clipboardyModule.writeSync === "function") {
    // Fallback voor oudere versies of andere exportstructuren
    writeSyncFunction = clipboardyModule.writeSync;
  } else {
    throw new Error("writeSync function not found in clipboardy module or its default export.");
  }
} catch (e) {
  console.error("❌ CRITICAL: Failed to import clipboardy or find writeSync function.");
  console.error("Error details:", e.message);
  console.error("   Please ensure clipboardy is installed correctly (`npm install clipboardy`).");
  process.exit(1);
}
// --- EINDE AANPASSING ---

const SRC_DIRECTORY = path.resolve(__dirname, "src");

function getAllJsFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        getAllJsFiles(fullPath, arrayOfFiles);
      } else if (path.extname(file) === ".js") {
        arrayOfFiles.push(fullPath);
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dirPath}: ${error.message}`);
  }
  return arrayOfFiles;
}

function bundleFiles() {
  if (!fs.existsSync(SRC_DIRECTORY)) {
    console.error(`❌ Error: Source directory "${SRC_DIRECTORY}" does not exist.`);
    process.exit(1);
  }

  const allJsFilePaths = getAllJsFiles(SRC_DIRECTORY);
  let bundledContent = `// Bundled on: ${new Date().toISOString()}\n`;
  bundledContent += `// Total files: ${allJsFilePaths.length}\n\n`;

  if (allJsFilePaths.length === 0) {
    console.log("ℹ️ No .js files found in the src directory. Nothing to copy.");
    return;
  }

  allJsFilePaths.forEach((filePath) => {
    const relativeFilePath = path.relative(process.cwd(), filePath);
    try {
      const fileContent = fs.readFileSync(filePath, "utf8");
      bundledContent += `// --- START OF FILE: ${relativeFilePath} ---\n`;
      bundledContent += fileContent;
      bundledContent += `\n// --- END OF FILE: ${relativeFilePath} ---\n\n`;
    } catch (error) {
      console.error(`Error reading file ${filePath}: ${error.message}`);
      bundledContent += `// --- ERROR READING FILE: ${relativeFilePath} ---\n`;
      bundledContent += `// Error: ${error.message}\n`;
      bundledContent += `// --- END OF ERROR FOR FILE: ${relativeFilePath} ---\n\n`;
    }
  });

  try {
    writeSyncFunction(bundledContent);
    console.log(
      `✅ Bundled code (${allJsFilePaths.length} files, ${bundledContent.length} chars) copied to clipboard!`
    );
  } catch (error) {
    console.error("❌ CRITICAL: Failed to copy to clipboard.");
    console.error("Error details:", error.message);
    console.error("ℹ️  Please ensure clipboard access is available in your environment.");
    console.error(
      "   On Linux, you might need to install xclip or xsel (e.g., sudo apt-get install xclip)."
    );
    console.error("   On Windows, this usually works out of the box.");
    process.exit(1);
  }
}

bundleFiles();
