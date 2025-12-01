// const fetch = require('node-fetch'); // Using global fetch in Electron/Node 18+
require('dotenv').config();

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Schema definition for the data we want to extract
const DATA_SCHEMA = {
    passportName: "Passport Name (Romanized)",
    nativeName: "Native Name (Japanese)",
    gender: "Gender (M/F)",
    occupation: "Occupation",
    nationality: "Nationality",
    birthday: "Birthday (YYYY/MM/DD)",
    ageAtTravel: "Age at Travel",
    studentPhone: "Student Phone Number",
    studentEmail: "Student Email",
    addressJa: "Address (Japanese)",
    addressEn: "Address (English)",
    emergencyNameJa: "Emergency Contact Name (Japanese)",
    emergencyNameEn: "Emergency Contact Name (English)",
    emergencyRelation: "Relationship to Student",
    emergencyPhone: "Emergency Contact Phone",
    emergencyEmail: "Emergency Contact Email",
    campus: "Campus Name",
    courses: [
        {
            course: "Course Name (e.g., ESL Classic, IELTS)",
            period: "Period (e.g., 8 weeks)",
            spartaType: "Sparta Type (Sparta/Semi-Sparta/Regular)"
        }
    ],
    entryDate: "Entry Date (YYYY/MM/DD)",
    totalPeriod: "Total Period",
    checkIn: "Check-in Date (YYYY/MM/DD)",
    checkOut: "Check-out Date (YYYY/MM/DD)",
    roomType: "Room Type (e.g., Single, 2-person room)",
    meal: "Meal Plan",
    pickup: "Pickup Request (Yes/No/Details)",
    holidays: "Holidays within period",
    remarks: "Remarks/Notes"
};

/**
 * Extracts structured data from raw text using OpenAI API.
 * @param {string} text - The raw text extracted from the PDF.
 * @param {string} model - The model to use (default: 'gpt-4o').
 * @returns {Promise<Object>} - The extracted data as a JSON object.
 */
async function extractDataFromText(text, model = 'gpt-4o') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not set in environment variables.");
    }

    const prompt = `
You are a data extraction assistant. Your task is to extract specific information from the provided text (which is from a school application form) and output it as a JSON object.

Here is the text to process:
"""
${text}
"""

Please extract the following fields and format them as a valid JSON object.
If a field is not found, use an empty string "" or null.
For dates, try to standardize to YYYY/MM/DD format if possible.

Required JSON Structure:
${JSON.stringify(DATA_SCHEMA, null, 2)}

IMPORTANT: Output ONLY the valid JSON object. Do not include any explanation or markdown formatting (like \`\`\`json).
`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout for OpenAI

        try {
            const response = await fetch(OPENAI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: "system", content: "You are a helpful assistant that extracts data into JSON format." },
                        { role: "user", content: prompt }
                    ],
                    response_format: { type: "json_object" }, // Force JSON mode
                    temperature: 0
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const data = await response.json();
            const jsonStr = data.choices[0].message.content;

            try {
                const parsedData = JSON.parse(jsonStr);
                return parsedData;
            } catch (parseError) {
                console.error("Failed to parse OpenAI response as JSON:", jsonStr);
                throw new Error("OpenAI did not return valid JSON.");
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('OpenAI request timed out after 30 seconds.');
            }
            throw error;
        }

    } catch (error) {
        console.error("Error calling OpenAI:", error);
        throw error;
    }
}

module.exports = {
    extractDataFromText
};
