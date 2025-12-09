const fs = require('fs');
const readline = require('readline');
const path = require('path');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const envPath = path.join(__dirname, '.env');

console.log("\n==========================================");
console.log(" 🛠️  TUTORIAL SETUP WIZARD");
console.log("==========================================\n");

// Define your questions here
const questions = [
    { key: 'API_KEY', prompt: 'Enter your API Key: ' },
    { key: 'API_SECRET', prompt: 'Enter your API Secret: ' },
    // { key: 'PORT', prompt: 'Enter Port (default 3000): ', default: '3000' }
];

const answers = {};

const askQuestion = (index) => {
    if (index === questions.length) {
        saveEnv();
        return;
    }

    const q = questions[index];
    rl.question(`👉 ${q.prompt}`, (answer) => {
        // Handle defaults
        if (!answer && q.default) {
            answer = q.default;
        }
        
        // Basic Validation (Optional)
        if (!answer && !q.default) {
            console.log("   ❌ Value cannot be empty. Please try again.");
            askQuestion(index);
            return;
        }

        answers[q.key] = answer.trim();
        askQuestion(index + 1);
    });
};

const saveEnv = () => {
    rl.close();
    
    let envContent = '';
    
    // If .env exists, read it first to preserve other vars
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        // Add a newline if it doesn't end with one
        if (!envContent.endsWith('\n')) envContent += '\n';
    }

    // Append new values
    for (const [key, value] of Object.entries(answers)) {
        // Check if key already exists to avoid duplicates (simple check)
        if (!envContent.includes(`${key}=`)) {
            envContent += `${key}=${value}\n`;
        } else {
            // Regex replace if it exists
            const regex = new RegExp(`^${key}=.*`, 'm');
            envContent = envContent.replace(regex, `${key}=${value}`);
        }
    }

    fs.writeFileSync(envPath, envContent);

    console.log("\n==========================================");
    console.log(" ✅ SETUP COMPLETE");
    console.log(" 📄 .env file has been created/updated.");
    console.log("==========================================");
    console.log("⚠️  NOTE: You may need to restart the server");
    console.log("    for these changes to take effect.");
    console.log("    Run: npm start\n");
};

// Start the wizard
askQuestion(0);