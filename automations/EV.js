const path = require("path");

const run = async ({ page, pdfText, log, env, llmData }) => {
    const LOGIN_URL = env.EV_LOGIN_URL || "https://www.evenglish.com/user-account/login";
    const FORM_URL = env.EV_FORM_URL || "https://www.evenglish.com/SECURE/index?device=desktop&hideForgotPassword=Y&logoPath=%2Fimages%2Fschool%2Flogo.png&logoMobilePath=%2Fimages%2Fschool%2Fev_small_logo.png&showImage=https%3A%2F%2Fwww.evenglish.com%2Fimages%2Fschool%2Fev_small_logo.png&favIcon=https%3A%2F%2Fwww.evenglish.com%2Fimages%2Fschool%2Fev_small_logo.png";
    const DEFAULT_TIMEOUT = 45000;
    const FAST_TIMEOUT = 5000;
    const LOGIN_USER = env.EV_USER || "blued";
    const LOGIN_PASS = env.EV_PASS || "blued.1173";
    const PERSON_IN_CHARGE = "千年倫子";
    const EMERGENCY_PHONE = "03-6455-3910";
    const STUDENT_PHONE_OVERRIDE = "StudentPhone";

    // --- Helper Functions ---

    const normalizeLine = (line) => line.trim();
    const normalizeLabel = (text) => (text || "").replace(/\s+/g, "").trim();
    const toHalfWidthNum = (str) =>
        (str || "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

    const withTimeout = (promise, ms = FAST_TIMEOUT) =>
        Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
        ]);

    const mapSpartaType = (courseText) => {
        if (!courseText) return "Sparta";
        const upper = courseText.toUpperCase();
        if (upper.includes("SEMI SPARTA") || upper.includes("SEMI-SPARTA")) return "Semi-Sparta";
        if (upper.includes("SPARTA")) return "Sparta";
        if (upper.includes("REGULAR")) return "Regular";
        return "Sparta";
    };

    const mapPeriodValue = (jpPeriod) => {
        if (!jpPeriod) return "";
        const match = jpPeriod.match(/(\d+)/);
        if (match) {
            return `${match[1]} Weeks`;
        }
        return jpPeriod;
    };

    const parseDateLikeJp = (text) => {
        if (!text) return null;
        const m = String(text).match(/(\d{4})[^\d]?(\d{1,2})[^\d]?(\d{1,2})/);
        if (!m) return null;
        const [_, y, mo, d] = m;
        const date = new Date(Number(y), Number(mo) - 1, Number(d));
        return isNaN(date.getTime()) ? null : date;
    };

    const formatDateWithDay = (date) => {
        const days = ["日", "月", "火", "水", "木", "金", "土"];
        const pad = (n) => String(n).padStart(2, "0");
        return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}(${days[date.getDay()]})`;
    };

    const adjustToNearestSunday = (text) => {
        const date = parseDateLikeJp(text);
        if (!date) return text || "";
        if (date.getDay() === 0) return formatDateWithDay(date);
        const prev = new Date(date);
        prev.setDate(date.getDate() - date.getDay());
        const next = new Date(date);
        next.setDate(date.getDate() + (7 - date.getDay()));
        const diffPrev = Math.abs(date - prev);
        const diffNext = Math.abs(next - date);
        const target = diffPrev <= diffNext ? prev : next;
        return formatDateWithDay(target);
    };

    const normalizeGenderValue = (val) => {
        if (!val) return "";
        const raw = String(val).trim();
        if (/[0-9@]/.test(raw)) return "";
        const lower = raw.toLowerCase();
        if (/female|woman|女性|女/.test(lower)) return "F";
        if (/male|man|男性|男/.test(lower)) return "M";
        return raw;
    };

    const normalizeStudentPhone = (val) => {
        if (val && /[0-9]/.test(val)) return val;
        return STUDENT_PHONE_OVERRIDE;
    };

    const isMeaningfulRemark = (text) => {
        if (!text) return false;
        const norm = normalizeLabel(text).toLowerCase();
        return norm && norm !== "なし" && norm !== "none" && norm !== "undefined" && norm !== "undified";
    };

    const extractNumeric = (text) => {
        if (!text) return "";
        const normalized = String(text).replace(/[０-９]/g, (d) =>
            String.fromCharCode(d.charCodeAt(0) - 0xfee0)
        );
        const m = normalized.match(/(\d+)/);
        return m ? m[1] : "";
    };

    const extractWeeks = (text) => {
        if (!text) return "";
        const normalized = String(text).replace(/[０-９]/g, (d) =>
            String.fromCharCode(d.charCodeAt(0) - 0xfee0)
        );
        const m = normalized.match(/(\d+)\s*週/);
        return m ? m[1] : "";
    };

    const summarizeRemarks = (text) => {
        if (!text) return "";

        const fields = {
            "アレルギー項目": null,
            "発症の程度": null,
            "通院の頻度": null,
            "症状": null,
            "処置方法": null
        };

        // Extract each field using regex
        let foundStructuredData = false;
        for (const [label, _] of Object.entries(fields)) {
            // Match pattern: ・アレルギー項目：value or アレルギー項目：value
            const pattern = new RegExp(`[・]?${label}[：:](.*?)(?=[・]|$)`, 's');
            const match = text.match(pattern);
            if (match && match[1]) {
                const value = match[1].trim();
                // Skip if value is "なし" or empty
                if (value && value !== "なし" && value !== "無し") {
                    fields[label] = value;
                    foundStructuredData = true;
                }
            }
        }

        // If we found structured data, build summary with only non-null fields
        if (foundStructuredData) {
            const summary = [];
            for (const [label, value] of Object.entries(fields)) {
                if (value !== null) {
                    summary.push(`${label}: ${value}`);
                }
            }
            return summary.join("\n");
        }

        // If no structured data found, clean up and return the original text
        // Remove common headers and questions
        let cleaned = text
            .replace(/アレルギー\/持病情報/g, '')
            .replace(/●.*?→.*?(?=<|$)/gs, '') // Remove questions like "●食べ物アレルギーはありますか？ →ある"
            .replace(/<アレルギーがある場合>/g, '')
            .replace(/\*変動の可能性はございます/g, '')
            .trim();

        return cleaned || "";
    };



    const translateJapaneseToEnglish = async (context, text) => {
        if (!text) return "";

        // Split by newlines and translate each line separately to preserve structure
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) return "";

        const translatedLines = [];

        for (const line of lines) {
            const page = await context.newPage();
            try {
                const encoded = encodeURIComponent(line);
                const url = `https://www.deepl.com/translator#ja/en/${encoded}`;
                await page.goto(url, { waitUntil: "domcontentloaded" });

                const targetContainer = "d-textarea[data-testid='translator-target-input']";
                const contentSelector = `${targetContainer} div[contenteditable='true']`;

                try {
                    await page.waitForSelector(contentSelector, { timeout: 10000 });
                } catch (e) {
                    log("DeepL target container not found.");
                    throw e;
                }

                // Wait for initial translation to appear
                await page.waitForFunction(
                    (selector) => {
                        const el = document.querySelector(selector);
                        return el && el.innerText.trim().length > 0;
                    },
                    contentSelector,
                    { timeout: 30000 }
                );

                // Wait for translation to stabilize (no changes for 2 seconds for shorter texts)
                let previousText = "";
                let stableCount = 0;
                const maxAttempts = 10;

                for (let i = 0; i < maxAttempts; i++) {
                    const currentText = await page.$eval(contentSelector, el => el.innerText.trim());

                    if (currentText === previousText && currentText.length > 0) {
                        stableCount++;
                        if (stableCount >= 2) {
                            translatedLines.push(currentText);
                            break;
                        }
                    } else {
                        stableCount = 0;
                    }

                    previousText = currentText;
                    await page.waitForTimeout(1000);
                }

                // If loop completed without breaking, use the last result
                if (stableCount < 2) {
                    const result = await page.$eval(contentSelector, el => el.innerText.trim());
                    translatedLines.push(result);
                }
            } catch (e) {
                log(`DeepL Translation failed for line "${line}": ${e.message}`);
                translatedLines.push(line); // Use original if translation fails
            } finally {
                await page.close();
            }
        }

        const finalResult = translatedLines.join('\n');
        log(`✅ DeepL translation complete: "${finalResult.substring(0, 100)}..."`);
        return finalResult;
    };

    const loadPdfValues = (pdfText) => {
        const rawLines = pdfText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);

        const labelPatterns = [
            /^EV校\s*お申込書$/, /^お客様情報$/, /^緊急連絡先情報$/, /^プラン情報$/,
            /^氏名（日本語）$/, /^パスポート記載氏名（ローマ字）$/, /^氏名（ローマ字）$/,
            /^性別$/, /^職業$/, /^国籍$/, /^生年月日$/, /^渡航時の年齢$/,
            /^電話番号$/, /^メールアドレス$/, /^ご住所（日本語）$/, /^ご住所（英語）$/,
            /^続柄$/, /^希望キャンパス/, /^希望コース/, /^学校期間/, /^入学希望日/,
            /^合計学校期間/, /^チェックイン希望日/, /^チェックアウト希望日/, /^お部屋タイプ/,
            /^お食事の有無/, /^ピックアップの希望有無/, /^期間内の祝日/, /^備考/,
            /^署$/, /^名$/,
        ];

        const isLabel = (line) => {
            const norm = normalizeLabel(line);
            return labelPatterns.some((p) => p.test(norm));
        };

        let valueLines = rawLines.filter((line) => !isLabel(line) && !/^\*/.test(line));
        const mapped = {};

        const addressEnIndex = valueLines.findIndex(line =>
            /,/.test(line) && /[A-Za-z]/.test(line) && !/@/.test(line) && !/^\d{4}\/\d{1,2}/.test(line)
        );

        if (addressEnIndex !== -1) {
            mapped.addressEn = valueLines[addressEnIndex];
            valueLines.splice(addressEnIndex, 1);
        } else {
            mapped.addressEn = "";
        }

        const valuesOrder = [
            "nativeName", "passportName", "gender", "occupation", "nationality", "birthday",
            "ageAtTravel", "studentPhone", "studentEmail", "addressJa", "addressEn",
            "emergencyNameJa", "emergencyNameEn", "emergencyRelation", "emergencyPhone",
            "emergencyEmail", "campus", "course", "coursePeriod", "entryDate", "totalPeriod",
            "checkIn", "checkOut", "roomType", "meal", "pickup", "holidays", "remarks",
        ];

        let vIdx = 0;
        valuesOrder.forEach((key) => {
            if (key === "addressEn") return;

            if (key === "entryDate") {
                while (vIdx < valueLines.length && !parseDateLikeJp(valueLines[vIdx])) {
                    if (mapped.course) {
                        mapped.course += " | " + valueLines[vIdx];
                    }
                    vIdx++;
                }
            }
            if (key === "holidays") {
                let merged = valueLines[vIdx] || "";
                vIdx++;
                while (vIdx < valueLines.length) {
                    const currentVal = merged.trim();
                    const nextLine = (valueLines[vIdx] || "").trim();
                    const endsWithComma = /[,\u3001]$/.test(currentVal);
                    const nextIsDate = /^\d{4}\/\d{1,2}\/\d{1,2}/.test(nextLine);
                    if (endsWithComma || nextIsDate) {
                        merged += nextLine;
                        vIdx++;
                    } else {
                        break;
                    }
                }
                mapped[key] = merged;
                return;
            }
            mapped[key] = valueLines[vIdx] || "";
            vIdx++;
        });

        const allDates = rawLines
            .map((line) => ({ line, date: parseDateLikeJp(line) }))
            .filter(({ date }) => date)
            .sort((a, b) => a.date - b.date);

        const earliestDateLine = allDates[0]?.line;
        const latestDateLine = allDates[allDates.length - 1]?.line;
        const hasValidDate = (text) => !!parseDateLikeJp(text);

        if (!hasValidDate(mapped.checkIn) && earliestDateLine) mapped.checkIn = earliestDateLine;
        if (!hasValidDate(mapped.checkOut) && latestDateLine) mapped.checkOut = latestDateLine;

        const frontStayLine = rawLines.find((line) => /前泊/.test(line) && parseDateLikeJp(line));
        if (frontStayLine) {
            mapped.checkIn = frontStayLine;
            if (mapped.remarks === frontStayLine) mapped.remarks = "";
        }

        mapped.gender = normalizeGenderValue(mapped.gender);
        mapped.studentPhone = normalizeStudentPhone(mapped.studentPhone);

        const entryDateObj = parseDateLikeJp(mapped.entryDate);
        if (entryDateObj) {
            const checkInCandidate = allDates
                .filter(({ date }) => date <= entryDateObj && entryDateObj - date <= 1000 * 60 * 60 * 24 * 30)
                .sort((a, b) => b.date - a.date)[0];

            const currentCheckInDate = parseDateLikeJp(mapped.checkIn);
            if (checkInCandidate && (!currentCheckInDate || currentCheckInDate > entryDateObj)) {
                mapped.checkIn = checkInCandidate.line;
            }

            const checkOutCandidate = allDates
                .filter(({ date }) => date >= entryDateObj)
                .sort((a, b) => b.date - a.date)[0];

            const currentCheckOutDate = parseDateLikeJp(mapped.checkOut);
            if (checkOutCandidate && (!currentCheckOutDate || currentCheckOutDate < entryDateObj)) {
                mapped.checkOut = checkOutCandidate.line;
            }
        }

        const courses = [];
        let courseIdx = 1;
        while (true) {
            const courseLabelRegex = new RegExp(`^${courseIdx === 1 ? "希望コース([①1])?" : `希望コース[${String.fromCharCode(0x2460 + courseIdx - 1)}${courseIdx}]`}`);
            const periodLabelRegex = new RegExp(`^${courseIdx === 1 ? "学校期間\\s*([①1])?" : `学校期間\\s*[${String.fromCharCode(0x2460 + courseIdx - 1)}${courseIdx}]`}`);

            let courseName = "";
            let period = "";
            let foundCourse = false;

            for (let i = 0; i < rawLines.length; i++) {
                const line = normalizeLine(rawLines[i]);
                if (courseLabelRegex.test(line)) {
                    let j = i + 1;
                    let val = "";
                    while (j < rawLines.length) {
                        const nl = normalizeLine(rawLines[j]);
                        if (isLabel(nl)) break;
                        if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(nl)) break;
                        if (/^\\*/.test(nl)) { j++; continue; }
                        val += (val ? " " : "") + nl;
                        j++;
                    }
                    courseName = val;
                    foundCourse = !!val;
                    break;
                }
            }

            if (!foundCourse) {
                const courseKeywords = ["ESL", "Power Speaking", "IELTS", "TOEIC", "Business", "Family", "Junior"];
                const coursePattern = new RegExp(`(${courseKeywords.join("|")}).*?\\((Sparta|Semi-Sparta)\\)`, "i");
                const allMatches = [];
                for (const line of rawLines) {
                    if (coursePattern.test(line)) {
                        allMatches.push(line);
                    }
                }
                if (allMatches.length >= courseIdx) {
                    courseName = allMatches[courseIdx - 1];
                    foundCourse = true;
                }
            }

            if (!foundCourse && courseIdx > 1) break;

            for (let i = 0; i < rawLines.length; i++) {
                const line = normalizeLine(rawLines[i]);
                if (periodLabelRegex.test(line)) {
                    let j = i + 1;
                    let val = "";
                    while (j < rawLines.length) {
                        const nl = normalizeLine(rawLines[j]);
                        if (isLabel(nl) || /^\\*/.test(nl)) break;
                        val += (val ? " " : "") + nl;
                        j++;
                    }
                    period = val;
                    break;
                }
            }

            if (courseName || period) {
                courses.push({ course: courseName, period: period });
            } else {
                break;
            }
            courseIdx++;
        }

        mapped.courses = courses;

        if (mapped.courses.length === 0 && mapped.course) {
            const parts = mapped.course.split("|").map(s => s.trim());
            const fallbackPeriod = mapped.coursePeriod || "8週間";
            let currentCourse = null;
            parts.forEach(part => {
                if (/週|Week/i.test(part)) {
                    if (currentCourse) currentCourse.period = part;
                } else {
                    if (currentCourse && !currentCourse.period) currentCourse.period = fallbackPeriod;
                    currentCourse = { course: part, period: "" };
                    mapped.courses.push(currentCourse);
                }
            });
            if (currentCourse && !currentCourse.period) currentCourse.period = fallbackPeriod;
        }

        if (mapped.courses.length > 0) {
            mapped.course = mapped.courses[0].course;
            mapped.coursePeriod = mapped.courses[0].period;
        }

        const roomLineIndex = rawLines.findIndex((line) => /(寮|部屋)/.test(line) && /\d/.test(line));
        if (roomLineIndex !== -1) {
            mapped.roomType = rawLines[roomLineIndex];
            mapped.meal = rawLines[roomLineIndex + 1] || "";
            mapped.pickup = rawLines[roomLineIndex + 2] || "";
        } else {
            const roomLine = rawLines.find((line) => /(寮|部屋)/.test(line) && /\d/.test(line));
            if (roomLine) mapped.roomType = roomLine;
        }

        const remarkLine = rawLines.find((line) => /(アレルギー|備考)/.test(line) && !/^\*/.test(line) && !isLabel(line));
        if (!mapped.remarks && remarkLine) mapped.remarks = remarkLine;

        return mapped;
    };

    const setInputValue = async (page, selector, value) => {
        if (!value) return;
        await page.waitForSelector(selector, { timeout: FAST_TIMEOUT });
        await page.evaluate(
            ({ selector, value }) => {
                const input = document.querySelector(selector);
                if (!input) throw new Error(`Input not found: ${selector}`);
                input.removeAttribute("readonly");
                input.disabled = false;
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            { selector, value }
        );
        log(`✏️  ${selector} に "${value}" をセットしました`);
    };

    const fillByLabel = async (page, labelText, value) => {
        if (!value) return;
        await withTimeout(
            page.evaluate(
                ({ labelText, value }) => {
                    const normalize = (txt) => (txt || "").replace(/\s+/g, " ").trim();
                    const equalsOrIncludes = (text, target) => {
                        const nText = normalize(text).toLowerCase();
                        const nTarget = normalize(target).toLowerCase();
                        return nText === nTarget || nText.includes(nTarget);
                    };
                    const matchLabelNode = () => {
                        const labels = Array.from(document.querySelectorAll("span.z-label"));
                        const bySpan = labels.find((node) => equalsOrIncludes(node.textContent, labelText));
                        if (bySpan) return bySpan;
                        const rows = Array.from(document.querySelectorAll(".z-row"));
                        for (const row of rows) {
                            const firstCell = row.querySelector(".z-cell, .z-row-inner");
                            const text = normalize(firstCell?.textContent || "");
                            const cleaned = normalize(text.replace(/^\*/, ""));
                            if (cleaned && equalsOrIncludes(cleaned, labelText)) return firstCell;
                        }
                        return null;
                    };

                    const labelNode = matchLabelNode();
                    if (!labelNode) throw new Error(`label not found: ${labelText}`);
                    const row = labelNode.closest(".z-row");
                    if (!row) throw new Error(`row not found for label: ${labelText}`);
                    const labelCell = labelNode.closest("td");
                    const siblingInput =
                        labelCell?.nextElementSibling?.querySelector(
                            "input:not([type='radio']):not([type='checkbox']), textarea, select"
                        ) || null;
                    const input =
                        siblingInput ||
                        row.querySelector("input:not([type='radio']):not([type='checkbox']), textarea, select") ||
                        row.querySelector("input");
                    if (!input) throw new Error(`input not found near label: ${labelText}`);
                    input.removeAttribute("readonly");
                    input.disabled = false;
                    input.value = value;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                },
                { labelText, value }
            ),
            FAST_TIMEOUT
        ).catch(() => { });
        log(`✏️  label "${labelText}" に "${value}" をセットしました`);
    };

    const selectFromDropdown = async (locator, value) => {
        if (!value) return;
        try {
            await locator.evaluate((el) => {
                el.removeAttribute('readonly');
                el.removeAttribute('disabled');
                el.removeAttribute('aria-readonly');
                el.removeAttribute('aria-disabled');
                el.readOnly = false;
                el.disabled = false;
            }).catch(() => { });

            await locator.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, value).catch(() => { });

            const page = locator.page();
            await page.waitForTimeout(300);
            log(`✅ Set combobox "${value}" via direct assignment`);
        } catch (e) {
            log(`⚠️ Failed to set combobox "${value}": ${e.message}`);
        }
    };

    const selectFromDropdownViaUI = async (page, row, colIndex, value) => {
        if (!value) return;
        await page.waitForTimeout(300);
        const combo = row.locator('.z-combobox').nth(colIndex);
        const btn = combo.locator('.z-combobox-button');

        for (let attempt = 0; attempt < 2; attempt++) {
            await btn.click();
            await page.waitForTimeout(500);

            try {
                const popup = page.locator('.z-combobox-popup:visible');
                await popup.waitFor({ state: 'visible', timeout: 2000 });

                const option = popup.locator('.z-comboitem').filter({ hasText: value }).first();
                if (await option.count() > 0) {
                    await option.click();
                    await popup.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => { });
                    await page.waitForTimeout(300);
                    return;
                } else {
                    const allOptions = await popup.locator('.z-comboitem').allTextContents();
                    log(`⚠️ Option "${value}" not found in dropdown via UI. Available: ${allOptions.join(', ')}`);
                    await page.keyboard.press('Escape');
                    await popup.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => { });

                    const input = combo.locator('.z-combobox-input');
                    await selectFromDropdown(input, value);
                    return;
                }
            } catch (e) {
                log(`⚠️ Popup did not appear or interaction failed (attempt ${attempt + 1}): ${e.message}`);
                if (attempt === 1) {
                    const input = combo.locator('.z-combobox-input');
                    await selectFromDropdown(input, value);
                }
            }
        }
    };

    const selectDateFromCalendar = async (page, dateObj) => {
        if (!dateObj) return;
        const popup = page.locator('.z-datebox-popup:visible').last();
        await popup.waitFor({ state: 'visible', timeout: 5000 });

        for (let i = 0; i < 60; i++) {
            const titleText = await popup.locator('.z-calendar-title').textContent();
            log(`  📅 Calendar title: "${titleText}"`);

            // Parse calendar title - it might be in format like "May 2026" or "2026年5月"
            let currentYear, currentMonth;

            // Try English format first (e.g., "May 2026" or "Dec 2026")
            const englishMatch = titleText.match(/([A-Za-z]+)\s+(\d{4})/);
            if (englishMatch) {
                const monthNames = {
                    "january": 0, "jan": 0,
                    "february": 1, "feb": 1,
                    "march": 2, "mar": 2,
                    "april": 3, "apr": 3,
                    "may": 4,
                    "june": 5, "jun": 5,
                    "july": 6, "jul": 6,
                    "august": 7, "aug": 7,
                    "september": 8, "sep": 8, "sept": 8,
                    "october": 9, "oct": 9,
                    "november": 10, "nov": 10,
                    "december": 11, "dec": 11
                };
                const monthStr = englishMatch[1].toLowerCase();
                currentMonth = monthNames[monthStr];
                if (currentMonth === undefined) {
                    log(`⚠️ Unknown month name: "${englishMatch[1]}"`);
                    currentMonth = 0;
                }
                currentYear = parseInt(englishMatch[2]);
            } else {
                // Try Japanese format (e.g., "2026年5月")
                const japaneseMatch = titleText.match(/(\d{4})年(\d{1,2})月/);
                if (japaneseMatch) {
                    currentYear = parseInt(japaneseMatch[1]);
                    currentMonth = parseInt(japaneseMatch[2]) - 1; // 0-indexed
                } else {
                    // Fallback: try to parse as date
                    const parsed = new Date(titleText);
                    if (!isNaN(parsed.getTime())) {
                        currentYear = parsed.getFullYear();
                        currentMonth = parsed.getMonth();
                    } else {
                        log(`⚠️ Could not parse calendar title: "${titleText}"`);
                        break;
                    }
                }
            }

            const targetYear = dateObj.getFullYear();
            const targetMonth = dateObj.getMonth();

            log(`  Current: ${currentYear}/${currentMonth + 1}, Target: ${targetYear}/${targetMonth + 1}`);

            if (targetYear === currentYear && targetMonth === currentMonth) {
                log(`  ✅ Reached target month`);
                break;
            }

            if (targetYear < currentYear || (targetYear === currentYear && targetMonth < currentMonth)) {
                log(`  ⬅️ Clicking left arrow to go back`);
                await popup.locator('.z-calendar-left').click();
            } else {
                log(`  ➡️ Clicking right arrow to go forward`);
                await popup.locator('.z-calendar-right').click();
            }
            await page.waitForTimeout(300);
        }

        // Wait for calendar to fully render after navigation
        await page.waitForTimeout(500);
        log(`  🔍 Looking for day ${dateObj.getDate()}...`);

        const day = dateObj.getDate();
        const dayCells = popup.locator('.z-calendar-cell');
        const cellCount = await dayCells.count();
        log(`  Found ${cellCount} calendar cells`);

        for (let i = 0; i < cellCount; i++) {
            const cell = dayCells.nth(i);
            const text = await cell.textContent();
            const classAttribute = await cell.getAttribute('class') || "";

            // Skip cells that are not for the current month or are disabled
            if (classAttribute.includes('z-calendar-outside') || classAttribute.includes('z-calendar-disabled')) {
                continue;
            }

            if (text.trim() === String(day)) {
                log(`  ✓ Found matching cell: text="${text.trim()}", class="${classAttribute}"`);
                try {
                    await cell.click();
                    log(`   Clicked day ${day}`);
                    break;
                } catch (clickError) {
                    log(`  ⚠️ Click failed: ${clickError.message}`);
                }
            }
        }

        log(`  📅 Finished searching for day ${day}`);

        await page.waitForTimeout(1000);
        await popup.waitFor({ state: 'hidden', timeout: 2000 }).catch(async () => {
            log('⚠️ Calendar popup did not close automatically, trying Escape...');
            await page.keyboard.press('Escape');
            await popup.waitFor({ state: 'hidden', timeout: 1000 }).catch(() => { });
        });
    };

    const waitForLabel = async (page, labelText) => {
        await page.waitForFunction(
            (text) => {
                const normalize = (val) => (val || "").replace(/\s+/g, " ").trim().toLowerCase();
                const hasSpan = Array.from(document.querySelectorAll("span.z-label")).some(
                    (node) => normalize(node.textContent) === normalize(text)
                );
                if (hasSpan) return true;
                return Array.from(document.querySelectorAll(".z-row")).some((row) => {
                    const firstCell = row.querySelector(".z-cell, .z-row-inner");
                    if (!firstCell) return false;
                    const cleaned = normalize(firstCell.textContent.replace(/^\*/, ""));
                    return cleaned === normalize(text);
                });
            },
            labelText,
            { timeout: DEFAULT_TIMEOUT }
        );
    };

    const maybeLogin = async (page) => {
        const userSel = "#account";
        const passSel = "#password";
        const submitSel = "form#login button[type='submit'], form#login button.btn-u, form#login input[type='submit']";

        const hasLoginForm = await page.$("form#login");
        if (!hasLoginForm) {
            const hasPassword = await page.$("input[type='password']");
            if (!hasPassword) return false;
        }

        await page.waitForSelector(userSel, { timeout: 8000 }).catch(() => { });
        await page.waitForSelector(passSel, { timeout: 8000 }).catch(() => { });

        await page.evaluate(
            ({ userSel, passSel, user, pass }) => {
                const u = document.querySelector(userSel);
                const p = document.querySelector(passSel);
                if (u) {
                    u.removeAttribute("readonly");
                    u.disabled = false;
                    u.value = user;
                    u.dispatchEvent(new Event("input", { bubbles: true }));
                    u.dispatchEvent(new Event("change", { bubbles: true }));
                }
                if (p) {
                    p.removeAttribute("readonly");
                    p.disabled = false;
                    p.value = pass;
                    p.dispatchEvent(new Event("input", { bubbles: true }));
                    p.dispatchEvent(new Event("change", { bubbles: true }));
                }
            },
            { userSel, passSel, user: LOGIN_USER, pass: LOGIN_PASS }
        );

        const submitBtn = await page.$(submitSel);
        if (submitBtn) {
            await Promise.all([
                submitBtn.click().catch(() => { }),
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => { }),
            ]);
        }

        return true;
    };

    // --- Execution Logic ---

    // Debug: Log raw PDF text to troubleshoot extraction issues
    log(`📝 PDFテキスト（最初の500文字）: ${pdfText.substring(0, 500)}`);
    log(`📝 PDFテキスト（最後の500文字）: ${pdfText.substring(Math.max(0, pdfText.length - 500))}`);

    let pdfValues;
    if (llmData) {
        log(`🤖 LLMデータを使用します: ${JSON.stringify(llmData, null, 2)}`);
        pdfValues = llmData;
    } else {
        // Fallback to regex-based parsing if LLM fails
        log(`⚠️ LLMデータがないため、正規表現でパースします`);
        pdfValues = loadPdfValues(pdfText);
    }

    log(`📄 最終抽出データ: ${JSON.stringify(pdfValues, null, 2)}`);
    log(`Courses found: ${JSON.stringify(pdfValues.courses, null, 2)}`);

    // Translate remarks only if meaningful (contains allergy/medical info, not just "なし")
    let translatedRemarks = "";
    if (isMeaningfulRemark(pdfValues.remarks)) {
        log(`📋 元の備考: ${pdfValues.remarks}`);

        // Summarize to extract only key fields
        const summarized = summarizeRemarks(pdfValues.remarks);

        if (summarized) {
            log(`📝 要約された備考: ${summarized}`);
            log(`🌐 備考を翻訳中...`);
            translatedRemarks = await translateJapaneseToEnglish(page.context(), summarized);
            log(`✅ 翻訳結果: ${translatedRemarks}`);
        } else {
            log(`ℹ️ 備考に有効な情報が見つかりませんでした`);
        }
    } else {
        log(`ℹ️ 備考は空または「なし」のため翻訳をスキップします`);
    }

    page.setDefaultTimeout(DEFAULT_TIMEOUT);

    // 1. Login
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 0 });
    log("🔐 ログインページを開きました。");
    const loggedIn = await maybeLogin(page);
    if (loggedIn) {
        log("🔐 ログイン処理を実行しました。");
        await page.waitForTimeout(1000);
    }

    // 2. Go to Form
    await page.goto(FORM_URL, { waitUntil: "domcontentloaded", timeout: 0 });
    log("🌐 EV ポータルを開きました（REGISTER は押さないでください）。");
    await waitForLabel(page, "Passport Name");

    // 3. Fill Basic Info
    try { await fillByLabel(page, "Passport Name", pdfValues.passportName); } catch (e) { log(`⚠️ Passport Name: ${e.message}`); }
    try { await fillByLabel(page, "Native Name", pdfValues.nativeName); } catch (e) { log(`⚠️ Native Name: ${e.message}`); }
    try { await fillByLabel(page, "Passport Number", ""); } catch (e) { log(`⚠️ Passport Number: ${e.message}`); }

    const gender = normalizeGenderValue(pdfValues.gender);
    try {
        const genderLabel = page.locator('span.z-label', { hasText: 'Gender' });
        const genderRow = genderLabel.locator('xpath=ancestor::tr[contains(@class, "z-row")]');
        const genderInput = genderRow.locator('.z-combobox-input').first();
        await selectFromDropdown(genderInput, gender);
    } catch (e) {
        log(`⚠️ Gender入力に失敗: ${e.message}`);
        try { await fillByLabel(page, "Gender", gender); } catch (e2) { log(`⚠️ Gender fallback失敗: ${e2.message}`); }
    }

    const studentPhone = normalizeStudentPhone(pdfValues.studentPhone);
    try { await fillByLabel(page, "Student's phone Number", studentPhone); } catch (e) { log(`⚠️ Student phone: ${e.message}`); }
    try { await fillByLabel(page, "Birthday", pdfValues.birthday); } catch (e) { log(`⚠️ Birthday: ${e.message}`); }
    try { await fillByLabel(page, "Email", pdfValues.studentEmail); } catch (e) { log(`⚠️ Email: ${e.message}`); }

    try { await fillByLabel(page, "Agency Branch", ""); } catch (e) { log(`⚠️ Agency Branch: ${e.message}`); }
    try { await fillByLabel(page, "Email for Invoice", "apply@studyin.jp"); } catch (e) { log(`⚠️ Email for Invoice: ${e.message}`); }
    try { await fillByLabel(page, "Emergency Phone Number", EMERGENCY_PHONE); } catch (e) { log(`⚠️ Emergency Phone Number: ${e.message}`); }

    // 4. Fill Courses
    log("🏫 コース情報の入力...");

    const courseHeader = page.locator('.z-auxheader-content', { hasText: 'Course' });
    const courseGrid = courseHeader.locator('xpath=ancestor::div[contains(@class, "z-grid")]');
    const courseRows = courseGrid.locator('.z-grid-body tr.z-row');

    let previousCourseStartDate = null;

    for (let i = 0; i < pdfValues.courses.length; i++) {
        const c = pdfValues.courses[i];
        log(`Processing Course ${i + 1}: ${JSON.stringify(c)}`);

        if (i > 0) {
            log("Adding new course row...");
            const addBtn = courseRows.nth(0).locator('button', { hasText: 'add' });
            await addBtn.click();
            await page.waitForTimeout(1500);
        }

        const row = courseRows.nth(i);

        let curriculum = c.course;
        let spartaType = c.spartaType || "";

        if (!spartaType) {
            const match = c.course.match(/^(.*?)\s*\((.*?)\)$/);
            if (match) {
                curriculum = match[1].trim();
                spartaType = match[2].trim();
            }
        }

        // Validate Course and Sparta/Semi-Sparta combination
        const validCourses = {
            "Sparta": [
                "Intensive ESL",
                "IELTS Guarantee",
                "IELTS",
                "TOEIC",
                "Business",
                "Digital English",
                "Power Speaking 6",
                "Power Speaking 8"
            ],
            "Semi-Sparta": [
                "ESL Classic",
                "TOEIC",
                "Business",
                "Digital English",
                "Power Speaking 6",
                "Power Speaking 8"
            ]
        };

        const mappedSpartaType = mapSpartaType(spartaType); // Normalize to "Sparta" or "Semi-Sparta"
        const allowedCourses = validCourses[mappedSpartaType] || [];

        // Check if the current curriculum exists in the allowed list for the selected type
        // We use a case-insensitive check to be safe
        const matchedCourse = allowedCourses.find(ac => ac.toLowerCase() === curriculum.toLowerCase());

        if (!matchedCourse) {
            log(`⚠️ 該当のコースが見当たりません: ${curriculum} (${mappedSpartaType})`);
            // Fallback: try to find it in the other list to see if type was wrong, or just proceed
            const otherType = mappedSpartaType === "Sparta" ? "Semi-Sparta" : "Sparta";
            if (validCourses[otherType].find(ac => ac.toLowerCase() === curriculum.toLowerCase())) {
                log(`   (ヒント: ${curriculum} は ${otherType} に存在します)`);
            }
        } else {
            // Use the canonical name from the list to ensure UI matching
            curriculum = matchedCourse;
        }

        const campusValue = "Main";
        const spartaValue = mappedSpartaType;
        const periodValue = mapPeriodValue(c.period);

        log(`  Campus: ${campusValue}, Sparta: ${spartaValue}, Curriculum: ${curriculum}, Period: ${periodValue}`);

        await selectFromDropdownViaUI(page, row, 0, campusValue);
        await selectFromDropdownViaUI(page, row, 1, spartaValue);
        await selectFromDropdownViaUI(page, row, 2, curriculum);
        await selectFromDropdownViaUI(page, row, 3, periodValue);

        let courseStartDate;
        if (i === 0) {
            courseStartDate = pdfValues.entryDate;
        } else {
            const prevCourse = pdfValues.courses[i - 1];
            const prevPeriodWeeks = extractWeeks(prevCourse.period) || extractNumeric(prevCourse.period) || 8;
            const baseDateObj = parseDateLikeJp(previousCourseStartDate);

            if (baseDateObj) {
                const nextStartDate = new Date(baseDateObj);
                nextStartDate.setDate(nextStartDate.getDate() + (prevPeriodWeeks * 7));
                const pad = (n) => String(n).padStart(2, '0');
                const days = ["日", "月", "火", "水", "木", "金", "土"];
                courseStartDate = `${nextStartDate.getFullYear()}/${pad(nextStartDate.getMonth() + 1)}/${pad(nextStartDate.getDate())}(${days[nextStartDate.getDay()]})`;
            } else {
                courseStartDate = pdfValues.entryDate;
            }
        }

        if (courseStartDate) {
            const nearestSunday = adjustToNearestSunday(courseStartDate);
            const startDateObj = parseDateLikeJp(nearestSunday);
            if (startDateObj) {
                log(`  Selecting Course ${i + 1} Start Date (nearest Sunday to ${courseStartDate}): ${nearestSunday}`);
                try {
                    const dateBtn = row.locator('.z-datebox-button').first();
                    log(`  📅 Clicking date button...`);
                    await dateBtn.click();
                    await page.waitForTimeout(1000); // Wait for calendar to appear
                    log(`  📅 Calling selectDateFromCalendar...`);
                    await selectDateFromCalendar(page, startDateObj);
                    previousCourseStartDate = nearestSunday;
                } catch (dateError) {
                    log(`⚠️ Date selection error for Course ${i + 1}: ${dateError.message}`);
                }
            }
        }
    }

    const courseSummary = `${pdfValues.course} / ${pdfValues.coursePeriod || pdfValues.totalPeriod || ""} / start ${pdfValues.entryDate} / checkout ${pdfValues.checkOut}`;
    try {
        await setInputValue(page, "#rKNQg3", courseSummary.trim());
    } catch (e) {
        // Ignore
    }

    const mapRoomType = (text) => {
        if (!text) return "";
        const t = text.trim();
        if (t.includes("内部")) {
            if (t.includes("１") || t.includes("1人")) return "Single";
            if (t.includes("２") || t.includes("2人")) return "Double";
            if (t.includes("３") || t.includes("3人")) return "Triple";
            return "Quad";
        }
        if (t.includes("外部")) {
            if (t.includes("１") || t.includes("1人")) return "Condo-Single";
            if (t.includes("２") || t.includes("2人")) return "Condo-Double";
            return "Walk-in";
        }
        return "";
    };
    const roomSource = pdfValues.roomType || pdfValues.checkOut || "";
    const dormType = mapRoomType(roomSource);
    const dormPeriod = extractWeeks(roomSource) || extractNumeric(roomSource) || "";
    const dormStart = adjustToNearestSunday(pdfValues.checkIn || "");

    try {
        log("🏠 寮情報の入力...");
        const dormHeader = page.locator('.z-auxheader-content', { hasText: 'Dormitory' });
        const dormGrid = dormHeader.locator('xpath=ancestor::div[contains(@class, "z-grid")]');
        const dormRow = dormGrid.locator('.z-grid-body tr.z-row').first();

        await selectFromDropdownViaUI(page, dormRow, 0, "Main");
        await selectFromDropdownViaUI(page, dormRow, 1, dormType);
        await selectFromDropdownViaUI(page, dormRow, 2, dormPeriod);

        if (dormStart) {
            const dormDateObj = parseDateLikeJp(dormStart);
            if (dormDateObj) {
                log(`  Selecting Dorm Start Date: ${dormStart}`);
                const dateBtn = dormRow.locator('.z-datebox-button').first();
                await dateBtn.click();
                await selectDateFromCalendar(page, dormDateObj);
            }
        }

        // Add translated remarks to Dormitory Special Request Note if meaningful
        if (translatedRemarks) {
            try {
                // Find textarea by placeholder attribute
                const noteTextarea = page.locator('textarea[placeholder*="Dormitory Special Request Note"]');
                await noteTextarea.waitFor({ timeout: 3000 });
                await noteTextarea.fill(translatedRemarks);
                log(`✅ Dormitory Special Request Noteに備考を入力: ${translatedRemarks}`);
            } catch (noteError) {
                log(`⚠️ Dormitory Special Request Note入力エラー: ${noteError.message}`);
            }
        }

        log("✅ 入力を完了しました。内容を確認してから REGISTER は手動で押してください。");
    } catch (e) {
        log(`⚠️ Dorm input error: ${e.message}`);
    }
};

module.exports = { run };
