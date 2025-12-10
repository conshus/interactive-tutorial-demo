const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const { execSync } = require('child_process');

// --- CONFIGURATION ---
const REPO_OWNER = process.env.GITHUB_REPOSITORY_OWNER || "YourUsername";
const REPO_NAME = process.env.GITHUB_REPOSITORY? process.env.GITHUB_REPOSITORY.split('/')[1] : "YourRepo";
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const TUTORIALS_BASE = path.join(__dirname, '../tutorials');
const DEVCONTAINER_BASE = path.join(__dirname, '../.devcontainer');

async function main() {
    // 1. Detect Zip File
    if (!fs.existsSync(UPLOADS_DIR)) return console.log("No uploads directory found.");
    const files = fs.readdirSync(UPLOADS_DIR).filter(f => f.endsWith('.zip'));
    
    if (files.length === 0) return console.log("No zip files to process.");
    // console.log('files[0]: ',files[0])
    // Process the first found zip file
    const zipFilename = files[0];
    const tutorialName = path.basename(zipFilename, '.zip').replace(/[^a-zA-Z0-9-_]/g, ''); // Sanitize name
    const targetDir = path.join(TUTORIALS_BASE, tutorialName);
    
    console.log(`🚀 Processing Tutorial: ${tutorialName}`);

    // 2. Extract Content
    // Ensure clean target directory
    if (fs.existsSync(targetDir)) fs.removeSync(targetDir);
    fs.ensureDirSync(targetDir);

    await fs.createReadStream(path.join(UPLOADS_DIR, zipFilename))
      .pipe(unzipper.Extract({ path: targetDir }))
      .promise();
    
    console.log("✅ Extraction complete.");

    // Locate Project Root & Check package.json
    // Sometimes zips contain a root folder (e.g. my-app/package.json) instead of files at root.
    let projectRoot = targetDir;
    
    // Check if package.json exists at extraction root
    if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
        console.log("ℹ️  package.json not found at root. Checking for nested directory...");
        // If not, check if there is a single subdirectory containing it
        let subdirs = fs.readdirSync(targetDir).filter(f => fs.statSync(path.join(targetDir, f)).isDirectory());
        console.log('subdirs.length before: ',subdirs.length);
        // FIX: Ignore the __MACOSX folder if it exists
        subdirs = subdirs.filter(dir => dir !== '__MACOSX');
        console.log('subdirs.length after: ',subdirs.length);
        if (subdirs.length === 1) {
            const nestedDir = path.join(targetDir, subdirs[0]);
            if (fs.existsSync(path.join(nestedDir, 'package.json'))) {
                console.log(`ℹ️  Found nested root in '${subdirs[0]}'. Flattening structure...`);
                // Move contents up to targetDir
                fs.copySync(nestedDir, targetDir);
                fs.removeSync(nestedDir);
            }
            // console.log(`ℹ️  Found project in subdirectory: ${subdirs}`);
        }
    } 
    // else if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
    //     console.error("❌ Error: package.json not found. Is this a valid Node.js project?");
    //     // Exit with error to fail the GitHub Action
    //     process.exit(1);
    // }


    // Explicit Check
    if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
        console.error("❌ Error: package.json not found. Is this a valid Node.js project?");
        // Exit with error to fail the GitHub Action
        process.exit(1);
    }


    // 3. Load Tutorial Configuration
    const configPath = path.join(targetDir, 'tutorial-config.json');
    if (!fs.existsSync(configPath)) {
        console.error("❌ Error: tutorial-config.json not found in zip root.");
        throw new Error("tutorial-config.json missing in zip!");
        process.exit(1);
    }
    const tutorialConfig = fs.readJsonSync(configPath);

    // --- 3b. CLONE EXTERNAL REPOSITORY into project subfolder ---
    const projectDir = path.join(targetDir, 'project');
    let hasExternalApp = false;

    // Ensure project dir exists even if we don't clone (for setup script destination)
    fs.ensureDirSync(projectDir);

    if (tutorialConfig.repository) {
        console.log(`🌐 Cloning external source: ${tutorialConfig.repository}`);
        const tempDir = path.join(__dirname, '../temp_clone');
        
        // Clean temp dir
        if (fs.existsSync(tempDir)) fs.removeSync(tempDir);
        fs.ensureDirSync(tempDir);

        try {
            // Clone to temp folder
            execSync(`git clone ${tutorialConfig.repository} .`, { cwd: tempDir, stdio: 'inherit' });
            
            // Remove .git folder so it becomes just a pile of files, not a sub-repo
            fs.removeSync(path.join(tempDir, '.git'));

            // MERGE LOGIC: Merge external package.json into the target (Astro) package.json
            // mergePackageJsons(targetDir, tempDir);
            
            // Copy files to targetDir, but DO NOT overwrite existing files 
            // (Preserves your tutorial-config.json and steps folder)
            fs.copySync(tempDir, projectDir, { overwrite: false });
            
            console.log("✅ External code cloned into /project subfolder.");
            hasExternalApp = true;
        } catch (err) {
            console.error("❌ Failed to clone external repository:", err);
            // We don't exit here, in case the zip has enough content to run anyway
        } finally {
            fs.removeSync(tempDir);
        }
    }    

    // --- NEW: SETUP SCRIPT MIGRATION ---
    // Check for setup-tutorial.js OR setup-project.js in root and move to project/setup-project.js
    const legacySetup = path.join(targetDir, 'setup-tutorial.js');
    const newSetup = path.join(targetDir, 'setup-project.js');
    const destSetup = path.join(projectDir, 'setup-project.js');
    let hasSetupScript = false;

    if (fs.existsSync(legacySetup)) {
        fs.moveSync(legacySetup, destSetup, { overwrite: true });
        hasSetupScript = true;
        console.log("📦 Moved setup-tutorial.js -> project/setup-project.js");
    } else if (fs.existsSync(newSetup)) {
        fs.moveSync(newSetup, destSetup, { overwrite: true });
        hasSetupScript = true;
        console.log("📦 Moved setup-project.js -> project/setup-project.js");
    }

    // --- CONFIGURE ROOT PACKAGE.JSON ---
    const rootPackageJson = path.join(targetDir, 'package.json');
    
    if (fs.existsSync(rootPackageJson)) {
        const pkg = fs.readJsonSync(rootPackageJson);
        
        pkg.devDependencies = pkg.devDependencies || {};
        pkg.devDependencies["http-server"] = "^14.1.1";
        // We add live-server as a fallback for pure frontend tutorials
        if (tutorialConfig.panels && tutorialConfig.panels.includes('browser') && !hasExternalApp) {
             pkg.devDependencies["live-server"] = "^1.2.2";
        }
        
        pkg.scripts = pkg.scripts || {};
        
        // 1. The Tutorial Server Script (Runs in background)
        pkg.scripts["start:tutorial"] = "http-server steps -p 1234 --cors -c-1";
        
        // 2. The Post-Install Script (Installs project deps)
        if (hasExternalApp) {
            pkg.scripts["postinstall"] = "cd project && npm install";
        }

        fs.writeJsonSync(rootPackageJson, pkg, { spaces: 2 });
        console.log("📦 Root package.json configured.");
    }

    // // --- INJECT DEPENDENCIES & START SCRIPT ---
    // // We add http-server and live-server to package.json here.
    // // This allows 'npm install' to handle them efficiently in the container.
    // const packageJsonPath = path.join(targetDir, 'package.json');

    // // We construct the start command based on whether the browser panel is needed
    // // let startCommand = "http-server steps -p 3000 --cors -c-1 > /dev/null 2>&1 &";

    // // Alaways start the tutorial steps server
    // let startCommand = "http-server steps -p 1234 --cors -c-1 > /dev/null 2>&1 &";

    // // Read package.json to see if we have an external app
    // let hasExternalApp = false;
    // if (fs.existsSync(packageJsonPath)) {
    //     const pkg = fs.readJsonSync(packageJsonPath);
    //     if (pkg.scripts && pkg.scripts["app:start"]) {
    //         hasExternalApp = true;
    //     }
    // }

    // // Run External App (If it exists, regardless of panels config)
    // if (hasExternalApp) {
    //     console.log("⚡ Detected external application. Wiring up 'app:start'...");
    //     startCommand += " npm run app:start &";
    // }

    // // Handle Browser Panel Logic
    // if (tutorialConfig.panels && tutorialConfig.panels.includes('browser')) {
    //     // We add the public port command here inside the package.json script
    //     // Note: We use 'wait' at the end to keep the process alive
    //     // If the user wants a browser but DOESN'T have an app, fallback to live-server
    //     // if (!hasExternalApp) {
    //         startCommand += " live-server --port=8080 --no-browser > /dev/null 2>&1 &";
    //     // }
    //     // 2. Add a 'sleep' so this message prints AFTER the server startup logs
    //     // 3. Print the clickable URL using the $CODESPACE_NAME variable
    //     // Note: We escape the $ so it is written literally into package.json
    //     const linkMsg = "echo \"\\n\\n--------------------------------------------------\\nYOUR APP IS READY:\\nhttps://\${CODESPACE_NAME}-8080.app.github.dev\\n--------------------------------------------------\\n\\n\"";
    //     startCommand += ` sleep 15 && ${linkMsg} & wait`;
    // } else {
    //     startCommand += " wait";
    // }
    
    // if (fs.existsSync(packageJsonPath)) {
    //     const pkg = fs.readJsonSync(packageJsonPath);
    //     pkg.devDependencies = pkg.devDependencies || {};
    //     pkg.devDependencies["http-server"] = "^14.1.1";
    //     pkg.devDependencies["live-server"] = "^1.2.2";

    //     pkg.scripts = pkg.scripts || {};
    //     pkg.scripts["start"] = startCommand;
        
    //     fs.writeJsonSync(packageJsonPath, pkg, { spaces: 2 });
    //     console.log("📦 Injected dev dependencies into package.json");
    // }

    // 4. Build Astro Starlight Project
    console.log("🔨 Building Astro Starlight project...");
    try {
        // Install dependencies and build. 
        // Assumes the zip root is the Astro project root.
        execSync('npm install && npm run build', { 
            cwd: targetDir, 
            stdio: 'inherit' 
        });
        
        // Move the 'dist' folder to 'steps' as requested
        const buildDir = path.join(targetDir, 'dist'); 
        const stepsDir = path.join(targetDir, 'steps');
        if (fs.existsSync(buildDir)) {
            fs.moveSync(buildDir, stepsDir, { overwrite: true });
            console.log("✅ Build successful. Output moved to /steps.");
        } else {
            console.error("⚠️  Build finished but 'dist' folder was not found.");
        }
    } catch (e) {
        console.error("❌ Astro build failed:", e.message);
        // We continue to generate files even if build fails, to allow debugging
    }

    // 5. Generate User Files (Boilerplate e.g., index.html, app.js)
    if (tutorialConfig.files && Array.isArray(tutorialConfig.files)) {
        tutorialConfig.files.forEach(fileName => {
            const filePath = path.join(targetDir, fileName);
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, `\n`);
                console.log(`📄 Created placeholder: ${fileName}`);
            }
        });
    }

    // 5b. Generate tasks.json
    // This creates the VS Code task to run 'npm start' automatically
    // generateTasksJson(targetDir);
    
    // 6. Generate Dynamic devcontainer.json
    // await generateDevContainer(tutorialName, tutorialConfig);
    await generateDevContainer(tutorialName, tutorialConfig, hasExternalApp, hasSetupScript);

    // 7. Generate README with Launch Button
    // This deep link points to the specific devcontainer configuration folder
    const deepLink = `https://codespaces.new/${REPO_OWNER}/${REPO_NAME}?devcontainer_path=.devcontainer/${tutorialName}/devcontainer.json`;
    
    const readmeContent = `
# ${tutorialName}

This tutorial environment has been automatically generated.

## Start Learning
Click the button below to launch a configured Codespace for this tutorial.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](${deepLink})

### Environment Details
- **Tutorial Steps**: Available in the preview pane (Port 1234).
- **Your Workspace**: Located in \`tutorials/${tutorialName}\`.
- **Project Code**: Located in \`tutorials/${tutorialName}/project\`.
    `;
    fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);

    // 8. Cleanup
    fs.removeSync(path.join(UPLOADS_DIR, zipFilename));
    console.log("🧹 Cleanup complete. Zip file removed.");
}

// // --- MERGE PACKAGE.JSONs ---
// function mergePackageJsons(targetDir, externalDir) {
//     const targetPkgPath = path.join(targetDir, 'package.json');
//     const externalPkgPath = path.join(externalDir, 'package.json');

//     if (!fs.existsSync(targetPkgPath) || !fs.existsSync(externalPkgPath)) {
//         return; // Nothing to merge
//     }

//     const targetPkg = fs.readJsonSync(targetPkgPath);
//     const externalPkg = fs.readJsonSync(externalPkgPath);

//     console.log("📦 Merging external package.json...");

//     // 1. Merge Dependencies (External takes precedence if versions conflict)
//     targetPkg.dependencies = {
//         ...targetPkg.dependencies,
//         ...externalPkg.dependencies
//     };
    
//     targetPkg.devDependencies = {
//         ...targetPkg.devDependencies,
//         ...externalPkg.devDependencies
//     };

//     // 2. Merge Scripts
//     // If the external repo has a 'start' script, rename it to 'app:start'
//     // so we can trigger it from our main start script later.
//     if (externalPkg.scripts && externalPkg.scripts.start) {
//         targetPkg.scripts = targetPkg.scripts || {};
//         targetPkg.scripts["app:start"] = externalPkg.scripts.start;
//         console.log(`   👉 Renamed external 'start' to 'app:start': ${externalPkg.scripts.start}`);
//     }

//     // Merge other scripts (excluding 'start' to avoid overwriting Astro's start temporarily)
//     if (externalPkg.scripts) {
//         for (const [key, cmd] of Object.entries(externalPkg.scripts)) {
//             if (key !== 'start') {
//                 targetPkg.scripts[key] = cmd;
//             }
//         }
//     }

//     // 3. Write merged file
//     fs.writeJsonSync(targetPkgPath, targetPkg, { spaces: 2 });
// }

function generateTasksJson(targetDir) {
    const vscodeDir = path.join(targetDir, '.vscode');
    fs.ensureDirSync(vscodeDir);

    const tasksConfig = {
        "version": "2.0.0",
        "tasks": [
            {
                "label": "Start Tutorial Environment",
                "type": "npm",
                "script": "start", // Runs the 'npm start' script we injected earlier
                "isBackground": true, // Keeps it running in background but visible in terminal
                "problemMatcher": {
                    "owner": "custom",
                    "pattern": {
                        "regexp": "^$"
                    },
                    "background": {
                        "activeOnStart": true,
                        "beginsPattern": "Starting up",
                        "endsPattern": "Available on"
                    }
                },
                "presentation": {
                    "reveal": "always",
                    "panel": "dedicated",
                    "group": "terminals"
                },
                "runOptions": {
                    "runOn": "folderOpen" // This makes it start automatically!
                }
            }
        ]
    };

    fs.writeFileSync(
        path.join(vscodeDir, 'tasks.json'),
        JSON.stringify(tasksConfig, null, 4)
    );
    console.log("✅ Generated .vscode/tasks.json");
}


async function generateDevContainer(name, config, hasExternalApp, hasSetupScript) {
    const devContainerDir = path.join(DEVCONTAINER_BASE, name);
    fs.ensureDirSync(devContainerDir);

    // --- CONSTRUCT THE DAISY CHAIN COMMAND ---
    // 1. Start Tutorial Server (Backgrounded & Silenced)
    // We run this from root because 'steps' is in root.
    let commandChain = "nohup npm run start:tutorial > /dev/null 2>&1 & ";

    // 2. Setup Script (Interactive)
    if (hasSetupScript) {
        // We echo a blank line to separate output from the prompt
        commandChain += "echo '' && cd project && node setup-project.js && ";
        // commandChain += "echo '' && cd project && gh codespace ports visibility 3000:public -c $CODESPACE_NAME && node setup-project.js && ";
    } else if (hasExternalApp) {
        // If no setup script but we need to run app, we still need to cd
        commandChain += "cd project && ";
    }

    // 3. Start Application
    if (hasExternalApp) {
        // Run the project's start script
        commandChain += "npm start";
    } else if (config.panels && config.panels.includes('browser')) {
        // Fallback: If no external app but browser requested, run live-server (from root)
        // Note: We need to be careful with 'cd' above. 
        // If we didn't cd into project, we run this from root.
        if (!hasSetupScript) {
             commandChain += "live-server --port=8080 --no-browser > /dev/null 2>&1 & wait";
        }
    } else {
        // If nothing else to run, just wait to keep container alive
        commandChain += "wait";
    }

    const portsAttributes = {
        "1234": { "label": "Tutorial Guide", "onAutoForward": "openPreview" }
    };

    if (config.panels && config.panels.includes('browser')) {
        portsAttributes["8080"] = {
            "label": "My Project Preview",
            "onAutoForward": "notify",
            "visibility": "public"
        };
    }

    // --- SMART FILE EXCLUSION LOGIC ---
    const defaultHidden = [
        "node_modules",
        "dist",
        "steps",
        ".devcontainer",
        ".vscode",
        "package.json",
        "package-lock.json",
        "tutorial-config.json",
        "tsconfig.json",
        "astro.config.mjs",
        ".git",
        ".DS_Store",
        "__MACOSX",
        "README.md",
        "markdoc.config.mjs",
        "project/setup-project.js" // Hide the moved setup script
    ];

    const filesExclude = {};
    const userFiles = config.files || [];

    defaultHidden.forEach(file => {
        if (!userFiles.includes(file)) {
            filesExclude[file] = true;
        }
    });

    const devContainerConfig = {
        "name": `Tutorial: ${name}`,
        "image": "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm",
        "workspaceFolder": `/workspaces/${REPO_NAME}/tutorials/${name}`,
        
        "waitFor": "onCreateCommand",
        "updateContentCommand": "npm install",
        "postCreateCommand": "",
        
        // THE MAGIC CHAIN
        "postAttachCommand": commandChain, 

        "features": {
             "ghcr.io/devcontainers/features/github-cli:1": {}
        },
        
        "customizations": {
            "vscode": {
                "extensions": [],
                "settings": {
                    "editor.formatOnSave": true,
                    "files.exclude": filesExclude
                }
            },
            "codespaces": {
                // Auto-fix paths for openFiles
                "openFiles": (config.files || []).map(f => {
                    if (f !== "README.md" && !f.startsWith("project/")) return `project/${f}`;
                    return f;
                })
            }
        },
        "portsAttributes": portsAttributes
    };

    fs.writeFileSync(path.join(devContainerDir, 'devcontainer.json'), JSON.stringify(devContainerConfig, null, 4));
    console.log(`✅ Generated devcontainer configuration in .devcontainer/${name}`);
}

// async function generateDevContainer(name, config) {
//     const devContainerDir = path.join(DEVCONTAINER_BASE, name);
//     fs.ensureDirSync(devContainerDir);

//     // Calculate where the tutorial files actually live
//     const targetDir = path.join(TUTORIALS_BASE, name);

//     // --- SMART STARTUP LOGIC ---
//     // Check if setup-tutorial.js exists and has content
//     let postAttachCommand = "npm start";
//     const setupFile = path.join(targetDir, "setup-tutorial.js");

//     if (fs.existsSync(setupFile)) {
//         const content = fs.readFileSync(setupFile, 'utf8').trim();
//         // If file exists and is not empty, assume manual setup is required.
//         // We set command to empty string so user enters terminal manually.
//         if (content.length > 0) {
//             console.log("ℹ️  Setup script detected. Disabling auto-start.");
//             postAttachCommand = ""; 
//         }
//     }

//     // -- Port & Preview Configuration --
//     // Port 1234: The Starlight Tutorial Steps
//     const portsAttributes = {
//         "1234": {
//             "label": "Tutorial Guide",
//             "onAutoForward": "openPreview"
//         }
//     };

//     // Port 8080: The User's Live Preview (if 'browser' panel requested)
//     if (config.panels && config.panels.includes('browser')) {
//         portsAttributes["8080"] = {
//             "label": "My Project Preview",
//             "onAutoForward": "notify",
//             "visibility": "public"
//         };
//     }

//     // --- SMART FILE EXCLUSION LOGIC ---
//     // 1. List of files we generally want to hide in a tutorial
//     const defaultHidden = [
//         ".astro",
//         "public",
//         "node_modules",
//         "vonage-toolbar",
//         "src",
//         "dist",
//         "steps",            // Hides the static site folder
//         ".devcontainer",    // Hides the config folder
//         ".vscode",
//         "package.json",
//         "package-lock.json",
//         "tutorial-config.json",
//         "setup-tutorial.js",
//         "tsconfig.json",
//         "astro.config.mjs",
//         ".git",
//         "README.md",
//         "markdoc.config.mjs",
//         ".DS_Store"
//     ];

//     // 2. Build the files.exclude object
//     const filesExclude = {};
//     const userFiles = config.files || [];

//     defaultHidden.forEach(file => {
//         // Only hide the file if the user didn't explicitly ask for it in the config
//         if (!userFiles.includes(file)) {
//             filesExclude[file] = true;
//         }
//     });
//     // ----------------------------------------
    
//     // -- Startup Commands --
//     // 1. Serve the 'steps' folder (static site) on port 3000
//     // 2. Serve the current directory on port 8080 (if browser requested)
//     // We use 'concurrently' or simple background '&' operators.
    
//     // let attachCommand = "nohup npx http-server steps -p 3000 --cors -c-1 > /dev/null 2>&1 &";
    
//     // if (config.panels && config.panels.includes('browser')) {
//     //     // live-server provides hot reload for the user's index.html
//     //     attachCommand += " nohup npx live-server --port=8080 --no-browser > /dev/null 2>&1 &";
//     // }

//     // -- The DevContainer Configuration Object --
//     const devContainerConfig = {
//         "name": `Tutorial: ${name}`,
//         "image": "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm",
        
//         // Isolate the user in the specific tutorial folder
//         "workspaceFolder": `/workspaces/${REPO_NAME}/tutorials/${name}`,

//         "waitFor": "onCreateCommand",

//         "updateContentCommand": "npm install",

//         // Run once when the container is created
//         "postCreateCommand": "",
        
//         // Run every time the user connects/attaches
//         "postAttachCommand": postAttachCommand,

//         "features": {
//             "ghcr.io/devcontainers/features/github-cli:1": {}
//         },
        
//         "customizations": {
//             "vscode": {
//                 "extensions": [],
//                 "settings": {
//                     "editor.formatOnSave": true,
//                     "files.exclude": filesExclude
//                 }
//             },
//             "codespaces": {
//                 "openFiles": config.files || []
//             }
//         },
        
//         "portsAttributes": portsAttributes,
        
//     };

//     // -- Terminal Panel Logic --
//     // If 'terminal' is requested, we don't need extra JSON config; 
//     // VS Code opens a terminal by default. 
//     // However, we can use tasks.json if specific split panes are needed.

//     fs.writeFileSync(
//         path.join(devContainerDir, 'devcontainer.json'), 
//         JSON.stringify(devContainerConfig, null, 4)
//     );
//     console.log(`✅ Generated devcontainer configuration in.devcontainer/${name}`);
// }

main().catch(err => {
    console.error(err);
    process.exit(1);
});
