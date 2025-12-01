const { extractDataFromText } = require('./llm_client');

const sampleText = `
EV校 お申込書
氏名（日本語）: 山田 太郎
Passport Name: YAMADA TARO
Gender: Male
Birthday: 1990/01/01
Course: ESL Classic (Sparta)
Period: 8 weeks
`;

(async () => {
    console.log("Testing LLM extraction with sample text...");
    try {
        const data = await extractDataFromText(sampleText);
        console.log("Extraction successful!");
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Extraction failed:", error.message);
        console.log("\nPlease ensure Ollama is running and you have pulled a model (e.g., 'ollama pull llama3').");
    }
})();
