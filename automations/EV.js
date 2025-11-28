const path = require("path");

const run = async ({ page, pdfText, log, env }) => {
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

    const translateJapaneseToEnglish = async (context, text) => {
        if (!text) return "";
        const page = await context.newPage();
        try {
            const encoded = encodeURIComponent(text);
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

            await page.waitForFunction(
                (selector) => {
                    const el = document.querySelector(selector);
                    return el && el.innerText.trim().length > 0;
                },
                contentSelector,
                { timeout: 20000 }
            );

            const result = await page.$eval(contentSelector, el => el.innerText);
            return result;
        } catch (e) {
            log(`DeepL Translation failed: ${e.message}`);
            return text;
        } finally {
            await page.close();
        }
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

        for (let i = 0; i < 24; i++) {
            const titleText = await popup.locator('.z-calendar-title').textContent();
            const currentViewDate = new Date(titleText);
            const targetYear = dateObj.getFullYear();
            const targetMonth = dateObj.getMonth();
            const currentYear = currentViewDate.getFullYear();
            const currentMonth = currentViewDate.getMonth();

            if (targetYear === currentYear && targetMonth === currentMonth) {
                break;
            }

            if (targetYear < currentYear || (targetYear === currentYear && targetMonth < currentMonth)) {
                await popup.locator('.z-calendar-left').click();
            } else {
                await popup.locator('.z-calendar-right').click();
            }
            await page.waitForTimeout(300);
        }

        const day = dateObj.getDate();
        const dayCells = popup.locator('.z-calendar-cell');
        const cellCount = await dayCells.count();

        for (let i = 0; i < cellCount; i++) {
            const cell = dayCells.nth(i);
            const text = await cell.textContent();
            if (text.trim() === String(day)) {
                await cell.click();
                break;
            }
        }

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

    const pdfValues = loadPdfValues(pdfText);
    log(`📄 PDF から抽出: ${JSON.stringify(pdfValues, null, 2)}`);
    log(`Courses found: ${JSON.stringify(pdfValues.courses, null, 2)}`);

    if (isMeaningfulRemark(pdfValues.remarks)) {
        log(`🌐 備考を翻訳中: ${pdfValues.remarks}`);
        pdfValues.remarks = await translateJapaneseToEnglish(page.context(), pdfValues.remarks);
        log(`✅ 翻訳結果: ${pdfValues.remarks}`);
    } else {
        pdfValues.remarks = "";
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
        let spartaType = "";
        const match = c.course.match(/^(.*?)\s*\((.*?)\)$/);
        if (match) {
            curriculum = match[1].trim();
            spartaType = match[2].trim();
        }

        const campusValue = "Main";
        const spartaValue = mapSpartaType(spartaType);
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
                const dateBtn = row.locator('.z-datebox-button').first();
                await dateBtn.click();
                await selectDateFromCalendar(page, startDateObj);
                previousCourseStartDate = nearestSunday;
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

        log("✅ 入力を完了しました。内容を確認してから REGISTER は手動で押してください。");
    } catch (e) {
        log(`⚠️ Dorm input error: ${e.message}`);
    }
};

module.exports = { run };
