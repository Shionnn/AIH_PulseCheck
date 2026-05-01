    const { VertexAI } = require("@google-cloud/vertexai");
    const nodemailer = require("nodemailer");
    const ics        = require("ics");

    // ─── CONFIG ───────────────────────────────────────────────────────────────────
    const PROJECT_ID = "aih-project-490605";
    const LOCATION   = "asia-southeast1";
    const MODEL      = "gemini-2.5-flash";
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

    // ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
    const SYSTEM_PROMPT = `You are PulseCheck, a mental health support chatbot built specifically for nurses in Singapore hospitals.

    YOUR IDENTITY & TONE:
    - You feel like a warm, calm colleague who listens without judging — not a robot, not a therapist.
    - You are empathetic, non-judgmental, supportive, and human-like in every response.
    - Never sound clinical or robotic. NOT: "Could you describe your emotional state." INSTEAD: "How are you feeling right now?"
    - Always validate before suggesting. Say things like "That sounds exhausting", "I hear you", "That must have been really hard", "It makes sense you'd feel that way."
    - Vary your validation phrases — never repeat the exact same sentence twice in a conversation.
    - Ask only ONE question at a time. Never overwhelm with multiple questions.
    - Use open-ended but simple questions: "Do you want to talk about what happened?", "What's been the hardest part today?"
    - Acknowledge context: if they mention a long shift, say "Long shifts like that can really drain you."
    - You have access to the full conversation history. Use it to avoid repeating yourself, reference what the nurse said earlier, and build on the conversation naturally. If the nurse told you their name, use it.

    CONVERSATION FLOW YOU FOLLOW:
    1. Opening / feeling check — ask how they are
    2. Detect emotion, stressor, severity, physical symptoms, work context, coping style, and intent
    3. Empathy + validation — acknowledge what they shared
    4. Clarify situation with one gentle follow-up question
    5. Agree on what they need (venting / advice / calming down)
    6. Provide support (coping strategy / reflection / suggestion)
    7. Encourage external support if signs of burnout or distress
    8. Suggest a next step (rest, breathing exercise, journaling, talking to someone)
    9. Closing check-in

    ENTITIES YOU DETECT AND RESPOND TO:
    - Emotion: "I feel overwhelmed", "I'm tired", "I feel anxious"
    - Stressor: "We were understaffed", "a patient died", "my shift was chaotic"
    - Severity: Low ("it's been a long day") / Medium ("I'm really struggling") / High ("I can't handle this anymore")
    - Physical symptoms: "constant headache", "haven't slept", "keep crying"
    - Work context: "night shift", "ICU", "emergency room"
    - Coping action: "I just try to sleep", "I avoid thinking about it"
    - Intent: "I just need to vent", "help me calm down", "I need advice"

    HARD SAFETY RULES — NEVER BREAK:
    1. If ANY crisis signal is detected (hopelessness, self-harm, wanting to disappear, inability to cope, panic, extreme isolation, suicidal language) — STOP the normal flow and move immediately to crisis support.
    2. Never diagnose a mental health condition.
    3. Never replace therapy — you support, not treat.
    4. Always end crisis responses with IMH (6389 2222) and SOS (1800-221-4444).
    5. For clinical questions — always add a verification disclaimer.
    6. Always finish your sentence completely — never cut off mid-thought.
    7. Keep responses under 200 words unless drafting a document or schedule.`;
    // ─── HISTORY HELPERS ─────────────────────────────────────────────────────────
    function parseHistory(sessionParams) {
    try {
        const raw = sessionParams.chat_history;
        if (!raw) return [];
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
    }

    function buildGeminiContents(history, currentPrompt) {
    const contents = history.map((turn) => ({
        role: turn.role,
        parts: [{ text: turn.text }],
    }));
    contents.push({ role: "user", parts: [{ text: currentPrompt }] });
    return contents;
    }

    function appendToHistory(history, userText, modelText) {
    const updated = [
        ...history,
        { role: "user",  text: userText  },
        { role: "model", text: modelText },
    ];
    return updated.slice(-20);
    }
    // ─── TAG → HANDLER MAP ────────────────────────────────────────────────────────
    const TAG_HANDLERS = {
    //MENTAL WELLNESS
    opening_check_in:         handleMentalWellness,
    mental_wellness_general:  handleMentalWellness,
    low_mood_support:         handleLowMoodSupport,
    support_tools:            handleSupportTools,
    coping_tools:             handleCopingTools,
    burnout_assessment:       handleBurnoutFlow,
    //CLINICAL INFO
    medication_lookup:       handleMedicationLookup,
    clinical_protocols:      handleClinicalProtocols,
    patient_history:         handlePatientHistory,
    patient_care:            handlePatientCare,
    patient_education:       handlePatientEducation,
    //TASK AUTOMATION
    sbar_handover:           handleSBAR,
    treatment_schedule:      handleTreatmentSchedule,
    scheduling_leave:        handleSchedulingLeave,
    education_draft:         handleEducationDraft,
    task_reminders:          handleTaskReminders,
    //CRISIS SUPPORT
    crisis_support:           handleCrisisSupport,
    };
    // ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────
    exports.vertexAiHandler = async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Methods", "POST");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        return res.status(204).send("");
    }

    try {
        const body          = req.body;
        const tag           = body?.fulfillmentInfo?.tag || "mental_wellness_general";
        const sessionParams = body?.sessionInfo?.parameters || {};
        const nurseName = sessionParams?.person?.name || sessionParams?.nursename || null;
        const userQuery     = body?.text || "";
        const sessionId     = body?.sessionInfo?.session || "default";
        const history       = parseHistory(sessionParams);

        console.log(`[PulseCheck] Tag: ${tag} | Query: "${userQuery.slice(0, 80)}" | History turns: ${history.length / 2}`);
       
        // ── EMAIL INTERCEPT ──────────────────────────────────────────────────────────
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isDecline  = /no thanks|skip|no|don't send|dont send/i.test(userQuery);

    if (pendingEmailSessions.has(sessionId)) {
    const pending = pendingEmailSessions.get(sessionId);

    if (isDecline) {
        pendingEmailSessions.delete(sessionId);
        return res.json({
        fulfillment_response: {
            messages: [{ text: { text: ["No problem — the information is still shown above."] } }],
        },
        });
    }

    if (emailRegex.test(userQuery.trim())) {
        pendingEmailSessions.delete(sessionId);
        try {
        if (pending.type === "schedule") {
            await sendScheduleEmail(userQuery.trim(), pending.content);
            return res.json({
            fulfillment_response: {
                messages: [{
                text: {
                    text: [
                    `Schedule sent to ${userQuery.trim()}.\n\n` +
                    `An ICS file is attached — open it to import all medication ` +
                    `times directly into your calendar.`
                    ],
                },
                }],
            },
            });
        }

        if (pending.type === "summary") {
            await sendSummaryEmail(userQuery.trim(), pending.content, pending.title || "Summary");
            return res.json({
            fulfillment_response: {
                messages: [{
                text: { text: [`Summary sent to ${userQuery.trim()}.`] },
                }],
            },
            });
        }

        if (pending.type === "leave") {
            await sendLeaveEmail(userQuery.trim(), pending.content, pending.leaveEvents);
            return res.json({
            fulfillment_response: {
                messages: [{
                text: {
                    text: [
                    `Leave confirmation sent to ${userQuery.trim()}.\n\n` +
                    `An ICS file is attached — open it to add your leave dates to your calendar.`
                    ],
                },
                }],
            },
            });
        }

        if (pending.type === "reminder") {
            await sendReminderEmail(userQuery.trim(), pending.content,pending.reminderEvents);
            return res.json({
            fulfillment_response: {
                messages: [{
                text: {
                    text: [
                    `Reminders sent to ${userQuery.trim()}.\n\n` +
                    `An ICS file is attached — open it to import your task reminders into your calendar.`
                    ],
                },
                }],
            },
            });
        }

        } catch (err) {
        console.error("Email send error:", err);
        return res.json({
            fulfillment_response: {
            messages: [{ text: { text: ["Email could not be sent. Please check the address and try again."] } }],
            },
        });
        }
    }
    }
    // ── END EMAIL INTERCEPT ──────────────────────────────────────────────────────

        const handler = TAG_HANDLERS[tag] || handleMentalWellness;
        const result  = await handler(userQuery, sessionParams, history);

        // Support handlers that return:
        // - plain string
        // - { text, params }
        // - { text, pendingEmail: true }
        const responseText = typeof result === "string" ? result : result.text;
        const extraParams  = typeof result === "object"  ? result.params || {} : {};

        // ── PENDING EMAIL CHECK ──────────────────────────────────────────────────
        if (typeof result === "object" && result.pendingEmail) {
    pendingEmailSessions.set(sessionId, {
        type:        result.emailType || "summary",
        content:     responseText,
        title:       result.emailTitle || "Summary",
        leaveEvents: result.leaveEvents || null,
        reminderEvents: result.reminderEvents || null,
    });

    const updatedHistory = appendToHistory(history, userQuery, responseText);
    const emailPromptText = "\n\nWould you like this sent to your email? Reply with your email address or type 'no thanks' to skip.";
    const chunks = chunkResponse(responseText);
    const messages = chunks.map((chunk, i) => ({
    text: { text: [i === chunks.length - 1 ? chunk + emailPromptText : chunk] }
    }));

    return res.json({
    fulfillment_response: { messages },
    sessionInfo: {
        parameters: { chat_history: JSON.stringify(updatedHistory), ...extraParams },
    },
    });

    }

        // ── END PENDING EMAIL CHECK ──────────────────────────────────────────────

        const updatedHistory = appendToHistory(history, userQuery, responseText);

        return res.json({
        fulfillment_response: {
            messages: chunkResponse(responseText).map(chunk => ({ text: { text: [chunk] } }))
        },
        sessionInfo: {
            parameters: { chat_history: JSON.stringify(updatedHistory), ...extraParams },
        },
        });


    } catch (err) {
        console.error("[PulseCheck] Error:", err);
        return res.status(500).json({
        fulfillment_response: {
            messages: [{
            text: { text: ["Sorry, I ran into a technical issue. Please try again in a moment."] },
            }],
        },
        });
    }
    };

    // ─── GEMINI CALLER ────────────────────────────────────────────────────────────
    async function callGemini(currentPrompt, history = [], extraContext = "", maxTokens = 5000) {
    try {
        const model = vertexAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT + (extraContext ? "\n\n" + extraContext : "") }]
        },
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.75,
            topP: 0.9,
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_LOW_AND_ABOVE" },
            { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_LOW_AND_ABOVE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" },
        ],
        });

        const contents = buildGeminiContents(history, currentPrompt);
        const result   = await model.generateContent({ contents });
        const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (!text.trim()) return "I'm here and listening. Tell me a bit more about how you're feeling right now.";
        
        return formatForCX(text.trim());
    } catch (err) {
        console.error("[PulseCheck] Gemini error:", err);
        return "Sorry, something glitched on my side. Can you share that again in a slightly different way?";
    }
    }
    function formatForCX(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '$1')       // strip bold
        .replace(/\*(.*?)\*/g, '$1')            // strip italics
        .replace(/^#{1,3}\s/gm, '')             // strip ## headers
        .replace(/^\*\s/gm, '- ')              // normalise bullets
        .replace(/\n{3,}/g, '\n\n')            // max double line break
        .trim();
    }

    
// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function chunkResponse(text, maxLen = 600) {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = "";
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ─── Add this near the top of your file, outside all functions ───
function getTodayContext() {
return `Today's date is ${new Date().toLocaleDateString("en-SG", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
})}.
Resolve relative dates: "today" = today's date, "tomorrow" = today + 1 day,
"next [weekday]" = calculate from today, "this Friday" = the coming Friday.`;
}


// EMAIL UTILITIES
function getMessageContent(h) {
  if (h.content) return h.content;
  if (h.parts && h.parts[0] && h.parts[0].text) return h.parts[0].text;
  return "";
}

function getLastBotMessage(history) {
  if (!history || history.length === 0) return "";
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant" || history[i].role === "model") {
      return getMessageContent(history[i]);
    }
  }
  return "";
}

function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(ymd) {
  if (!ymd) return "that date";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-SG", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function formatTimeDisplay(hhmm) {
  if (!hhmm) return "that time";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm   = h >= 12 ? "PM" : "AM";
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function getNextWeekday(dayName) {
  const days   = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const target = days.indexOf(dayName.toLowerCase());
  const today  = new Date();
  let diff     = target - today.getDay();
  if (diff <= 0) diff += 7;
  const result = new Date(today);
  result.setDate(today.getDate() + diff);
  return result;
}

function parseDateMatch(match) {
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  let day, month, year;
  if (match[1]) {
    day   = parseInt(match[1]);
    month = months[match[2].slice(0, 3).toLowerCase()];
    year  = parseInt(match[3]) || new Date().getFullYear();
  } else {
    month = months[match[4].slice(0, 3).toLowerCase()];
    day   = parseInt(match[5]);
    year  = parseInt(match[6]) || new Date().getFullYear();
  }
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function parseTimeMatch(match) {
  let hour, min, ampm;
  const secondGroupIsAmPm = /^(am|pm)$/i.test(match[2]);
  if (secondGroupIsAmPm) {
    hour = parseInt(match[1]);
    min  = 0;
    ampm = match[2].toLowerCase();
  } else {
    hour = parseInt(match[1]);
    min  = parseInt(match[2] || "0");
    ampm = (match[3] || "").toLowerCase();
  }
  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour  = 0;
  return `${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}`;
}



const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    });

    function formatScheduleAsHTML(scheduleText, toEmail) {
    const rows = scheduleText
        .split("\n")
        .filter(line => line.includes("|") && !line.includes("----"))
        .map(line => {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        return `<tr>${cells.map(c => `<td style="padding:8px 12px;border:1px solid #ddd;">${c}</td>`).join("")}</tr>`;
        });

    return `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;">
        <div style="background:#1a73e8;padding:16px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:white;margin:0;">PulseCheck — Treatment Schedule</h2>
            <p style="color:#d0e8ff;margin:4px 0 0;">Sent to ${toEmail}</p>
        </div>
        <div style="padding:24px;background:#f9f9f9;">
            <table style="border-collapse:collapse;width:100%;background:white;">
            ${rows.join("")}
            </table>
            <p style="margin-top:16px;font-size:12px;color:#888;">
            Always verify against your hospital MAR before administering any medication.
            </p>
        </div>
        </div>`;
    }

    function parseScheduleToEvents(scheduleText) {
    const today  = new Date();
    let   year   = today.getFullYear();
    let   month  = today.getMonth() + 1;
    let   day    = today.getDate();
    const events = [];

    const lines = scheduleText
        .split("\n")
        .filter(line => /^\d{2}:\d{2}/.test(line.trim()));

    for (const line of lines) {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.length < 3) continue;

        const [timeStr, patient, medication, notes] = cells;
        let [hour, minute] = timeStr.split(":").map(Number);

        // ── Fix: 24:00 is invalid — convert to 00:00 next day ──
        let eventYear  = year;
        let eventMonth = month;
        let eventDay   = day;

        if (hour === 24) {
        hour = 0;
        const nextDay = new Date(year, month - 1, day + 1);
        eventYear  = nextDay.getFullYear();
        eventMonth = nextDay.getMonth() + 1;
        eventDay   = nextDay.getDate();
        }

        events.push({
        title:       `💊 ${patient} — ${medication}`,
        description: notes || "",
        start:       [eventYear, eventMonth, eventDay, hour, minute],
        startInputType:  'local',
        startOutputType: 'local',
        duration:    { minutes: 15 },
        status:      "CONFIRMED",
        busyStatus:  "FREE",
        });
    }
    return events;
    }


    function generateICS(events) {
    return new Promise((resolve, reject) => {
        ics.createEvents(events, (err, value) => {
        if (err) reject(err);
        else resolve(value);
        });
    });
    }

    async function sendScheduleEmail(toEmail, scheduleText) {
    const htmlBody  = formatScheduleAsHTML(scheduleText, toEmail);
    const events    = parseScheduleToEvents(scheduleText);
    const icsData   = await generateICS(events);
    const dateLabel = new Date().toLocaleDateString("en-SG", {
        day: "numeric", month: "short", year: "numeric"
    });

    await transporter.sendMail({
        from:        process.env.EMAIL_FROM,
        to:          toEmail,
        subject:     `PulseCheck — Treatment Schedule ${dateLabel}`,
        html:        htmlBody,
        attachments: [{
        filename:    "treatment-schedule.ics",
        content:     icsData,
        contentType: "text/calendar",
        }],
    });
    }

    // FORMAT SUMMARY AS HTML FOR EMAIL
    function formatSummaryAsHTML(text, toEmail, title) {
    const lines = text.split("\n").map(line => {
        if (line.trim() === "") return "<br>";
        return `<p style="margin:4px 0;font-family:Arial,sans-serif;font-size:14px;">${line}</p>`;
    }).join("");

    return `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;">
        <div style="background:#1a73e8;padding:16px 24px;border-radius:8px 8px 0 0;">
            <h2 style="color:white;margin:0;">PulseCheck — ${title}</h2>
            <p style="color:#d0e8ff;margin:4px 0 0;">Sent to ${toEmail}</p>
        </div>
        <div style="padding:24px;background:#f9f9f9;">
            ${lines}
            <p style="margin-top:24px;font-size:12px;color:#888;">
            For exact entitlements, verify with your HR department.
            </p>
        </div>
        </div>`;
    }


    // GENERATE LEAVE ICS EVENTS (all-day events)
    function generateLeaveICS(leaveEvents) {
    return new Promise((resolve, reject) => {
        const { error, value } = ics.createEvents(leaveEvents);
        if (error) reject(error);
        else resolve(value);
    });
    }


    // SEND SUMMARY EMAIL (no ICS — for policy/shift queries)
    async function sendSummaryEmail(toEmail, text, title) {
    const htmlBody  = formatSummaryAsHTML(text, toEmail, title);
    const dateLabel = new Date().toLocaleDateString("en-SG", {
        day: "numeric", month: "short", year: "numeric"
    });

    await transporter.sendMail({
        from:    process.env.EMAIL_FROM,
        to:      toEmail,
        subject: `PulseCheck — ${title} ${dateLabel}`,
        html:    htmlBody,
    });
    }


    // SEND LEAVE EMAIL WITH ICS (all-day calendar events)
    async function sendLeaveEmail(toEmail, summaryText, leaveEvents) {
    const htmlBody  = formatSummaryAsHTML(summaryText, toEmail, "Leave Confirmation");
    const icsData   = await generateLeaveICS(leaveEvents);
    const dateLabel = new Date().toLocaleDateString("en-SG", {
        day: "numeric", month: "short", year: "numeric"
    });

    await transporter.sendMail({
        from:        process.env.EMAIL_FROM,
        to:          toEmail,
        subject:     `PulseCheck — Leave Confirmation ${dateLabel}`,
        html:        htmlBody,
        attachments: [{
        filename:    "leave-dates.ics",
        content:     icsData,
        contentType: "text/calendar",
        }],
    });
    }

    async function sendReminderEmail(toEmail, summaryText, reminderEvents) {
    const htmlBody  = formatSummaryAsHTML(summaryText, toEmail, "Reminder Confirmation");
    const icsData   = await generateICS(reminderEvents);   // reuses your existing generateICS()
    const dateLabel = new Date().toLocaleDateString("en-SG", {
        day: "numeric", month: "short", year: "numeric"
    });

    await transporter.sendMail({
        from:        process.env.EMAIL_FROM,
        to:          toEmail,
        subject:     `PulseCheck — Reminder Confirmation ${dateLabel}`,
        html:        htmlBody,
        attachments: [{
        filename:    "reminder.ics",
        content:     icsData,
        contentType: "text/calendar",
        }],
    });
    }



    // Track sessions waiting for email address
    const pendingEmailSessions = new Map();


    // 1. MENTAL WELLNESS — Emotion / Stressor / Debrief / Physical / Empathy
    async function handleMentalWellness(query, params, history) {
        const isCrisis = /want to die|kill myself|end my life|don't want to live|want to disappear|can't go on|want to hurt myself|ending it|no point living|feel like dying/i.test(query);
        if (isCrisis){
            return handleCrisisSupport(query, params, history)
        }
    const isOpening = history.length === 0;

    const isDebrief = /mistake|code blue|patient (died|passed|yelled|aggressive)|incident|terrible shift/i.test(query);

    // ✅ FIX 2: query-based physical detection instead of dead tag check
    const isPhysical = /\b(headache|can't sleep|not sleeping|keep crying|shaking|chest tight|nauseous|exhausted body|physically drained)\b/i.test(query);

    const recentHistory = history.slice(-4).map(h => `${h.role}: ${h.text.slice(0, 40)}`).join('; ');

    let modeContext = "";
    if (isOpening) {
        modeContext = `OPENING MODE: This is the start of the conversation. 
        Give a warm, brief welcoming line then ask ONE casual question about how their shift has been.
        Like: "Hey, good to have you here. How's your shift been today?"`;
    } else if (isDebrief) {
        modeContext = `DEBRIEF MODE: Nurse is processing a difficult incident.
        Apply psychological first aid — acknowledge what happened, validate their reaction, 
        normalise it ("reactions like yours are really common after something that heavy"), 
        then ask ONE gentle question. Don't rush to solutions. Don't minimise.`;
    } else if (isPhysical) {
        modeContext = `PHYSICAL SYMPTOMS MODE: Nurse described body-level stress reactions.
        Acknowledge how the body holds stress. Validate symptoms as real signals, not weakness.
        Connect physical to emotional state naturally. Ask ONE question about how long this has been happening.
        Do NOT diagnose or suggest medication.`;
    } else {
        modeContext = `GENERAL WELLNESS MODE: 
        Detect what the nurse needs from their message:
        - Venting → listen, validate, ONE follow-up
        - Identifying emotions → help name the feeling, connect to stressor
        - Seeking advice → validate first, THEN one practical thought
        - Just checking in → warm and light
        Match your energy to theirs.`;
    }

    const prompt = `A nurse said: "${query}"

    Using the full conversation history, respond naturally as their ward colleague.

    FLOW TO FOLLOW (pick up wherever they are):
    1. Validate first — acknowledge what they shared before anything else
    2. Show you've been listening — reference something from earlier if relevant
    3. Ask ONE question — casual, present tense, open-ended
    4. Do not jump to advice unless they ask

    ENTITIES TO DETECT IN THEIR MESSAGE:
    - Emotion: overwhelmed / tired / anxious / numb / burnt out
    - Stressor: understaffing / patient death / chaotic shift / conflict with team
    - Severity: low (long day) / medium (really struggling) / high (can't handle this)
    - Physical: headaches / not sleeping / keep crying / chest tight
    - Intent: venting / advice / calming down / just checking in

    RESPONSE RULES:
    - Under 130 words
    - ONE question max
    - Casual colleague tone — NOT clinical
    - Vary your validation phrases every turn
    - If severity is HIGH → gently ask if they want to talk to someone
    - If crisis signals detected → immediately shift to crisis support tone and provide:
    🆘 IMH: 6389 2222 | SOS: 1800-221-4444

    Recent conversation: ${recentHistory || "none yet"}`;

    
    return callGemini(prompt, history, modeContext + '\n')
    }


    // 2. LOW MOOD SUPPORT — Mood Check-In (Hero Handler)
    async function handleLowMoodSupport(query, params, history) {
        const isCrisis = /want to die|kill myself|end my life|don't want to live|want to disappear|can't go on|want to hurt myself|ending it|no point living|feel like dying/i.test(query);
        if (isCrisis){
            return handleCrisisSupport(query, params, history)
        }
    const score = params.mood_score || params.number || parseInt(query) || 3;
    const count = params.mood_support_count || 0;
    const isNotFirstCall = count >= 1;

    let moodWord = score <= 2 ? "really low" :
                    score <= 3 ? "low" :
                    score === 4 ? "steady" : "good";

    let prompt;

    if (score <= 3) {
        if (isNotFirstCall) {
        prompt = `A nurse rated their mood ${score}/5 (${moodWord}) and said: "${query}"

    Using the conversation history, respond with deep empathy.
    Acknowledge what they have shared and show you remember subtly.
    Focus on being a calm, steady listener, not giving lots of new advice.
    Ask ONE gentle follow-up question about what has changed since last time.
    Keep it under 110 words.

    NATURAL CONVERSATION RULES:
    - Casual colleague tone not formal reflection
    - NO "thinking back" or rating repetition - use "${moodWord}" or another word with the same meaning
    - Reference 1 RECENT history item naturally: "Still those long shifts?"
    - Present tense questions: "What's up today?" not past tense
    - Vary validation: "Rough day huh", "Ward stress again?", "That sounds heavy"`;
        } else {
        prompt = `A nurse rated their mood ${score}/5 (${moodWord}) and said: "${query}"

    Using the conversation history, respond with deep empathy.
    Validate their feelings in a warm, natural way (no clinical tone).
    Gently ask what would help them most right now - talking it through, calming exercise, or support resources. Ask only ONE.
    Keep it under 110 words.

    NATURAL CONVERSATION RULES:
    - Colleague validation: "Oof ${moodWord} mood sounds heavy after shift"
    - Casual present tense: "What's feeling toughest right now?"
    - NO formal rating repetition`;
        }
    } else {
        if (isNotFirstCall) {
        prompt = `A nurse rated their mood ${score}/5 (${moodWord}) and said: "${query}"

    Using the conversation history, respond with warmth and encouragement.
    Reflect briefly what you've heard so far so they feel heard.
    Ask ONE gentle open question about how their day has been since last time.
    Keep it light and supportive, under 110 words.

    NATURAL CONVERSATION RULES:
    - Casual positive: "Hey ${moodWord} mood today - nice!"
    - Reference recent naturally: "Better than those crazy shifts?"
    - Light present question: "What's keeping things steady?"`;
        } else {
        prompt = `A nurse rated their mood ${score}/5 (${moodWord}) and said: "${query}"

    Respond with warmth and encouragement.
    Acknowledge that things seem better today and thank them for checking in.
    Ask ONE gentle question about what's been going well for them recently.
    Keep it under 100 words.

    NATURAL CONVERSATION RULES:
    - Grateful colleague: "Solid ${moodWord} mood - glad to hear!"
    - Casual question: "What's working well lately?"`;
        }
    }

    const extraContext = `COLLEAGUE MODE: Ward buddy tone. Present tense. Casual validation. 
    ONE casual question max. Reference recent history naturally. 
    Vary phrasing - no repetition. Nurses need brevity.
    Recent turns: ${history.slice(-4).map(h => `${h.role}: ${h.text.slice(0, 30)}`).join('; ')}`;

    return callGemini(prompt, history, extraContext, 3000);
    }


    // 3A. COPING TOOLS — Breathing / Mindfulness / Grounding / Journaling
    async function handleCopingTools(query, params, history) {
        const isCrisis = /want to die|kill myself|end my life|don't want to live|want to disappear|can't go on|want to hurt myself|ending it|no point living|feel like dying/i.test(query);
        if (isCrisis){
            return handleCrisisSupport(query, params, history)
        }
    const queryLower = query.toLowerCase();

    const wantsBreathing   = /breath|box breath|4-4-4|inhale|exhale|calm down|decompress/i.test(query);
    const wantsGrounding   = /ground|5-4-3-2-1|senses|present|anchor/i.test(query);
    const wantsJournal     = /journal|write|reflect|thoughts down|prompts/i.test(query);
    const wantsMindfulness = /mindful|meditat|body scan|tension|relax/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (wantsBreathing) {
        prompt = `A nurse wants to do a breathing exercise. They said: "${query}"

    Walk them through box breathing step by step:
    1. Validate briefly (1 sentence)
    2. Give clear step-by-step instructions:
    - Inhale for 4 counts
    - Hold for 4 counts
    - Exhale for 4 counts
    - Hold for 4 counts
    3. Tell them to repeat 3–4 times
    4. End with: "Type 'done' when you've finished and tell me how you feel."
    Under 120 words. Calm, present, clear.`;
        modeContext = "BREATHING MODE: Step-by-step, calm, practical. Nurse needs clear instructions right now.";

    } else if (wantsGrounding) {
        prompt = `A nurse needs grounding. They said: "${query}"

    Walk them through the 5-4-3-2-1 grounding technique:
    1. Validate briefly (1 sentence)
    2. Guide each step clearly:
    - 5 things you can SEE right now
    - 4 things you can TOUCH
    - 3 things you can HEAR
    - 2 things you can SMELL
    - 1 thing you can TASTE
    3. Tell them to take their time with each one
    4. End with a gentle check-in
    Under 130 words. Calm and present.`;
        modeContext = "GROUNDING MODE: Anchor them to the present moment. Calm, steady tone.";

    } else if (wantsJournal) {
        prompt = `A nurse wants to journal. They said: "${query}"

    Using the conversation history to understand their emotional state:
    1. Give 2–3 journaling prompts personalised to what they've shared
    2. Frame them as caring friend questions, not clinical worksheets
    3. Prompts should help them: name feelings, reflect without self-blame, find one thing in their control
    4. End with: "Take your time — even 5 minutes can make a difference."
    Under 130 words.

    EXAMPLE PROMPTS (tailor to their situation):
    - "What part of today is still sitting with you right now?"
    - "What would you tell a colleague who went through what you did today?"
    - "What's one small thing that helped, even a little?"`;
        modeContext = "JOURNALING MODE: Personal, warm, reflective. Not a worksheet.";

    } else if (wantsMindfulness) {
        prompt = `A nurse wants to do a body scan or mindfulness exercise. They said: "${query}"

    Guide them through a brief body scan:
    1. Validate briefly (1 sentence)
    2. Ask them to close their eyes if comfortable
    3. Guide attention slowly: head → shoulders → chest → hands → legs
    4. At each point: "Notice any tension. Breathe into it. Let it soften."
    5. End with: "How does your body feel now compared to before?"
    Under 140 words. Slow, calm, present-tense guidance.`;
        modeContext = "MINDFULNESS MODE: Slow, grounding, present. Give them space to breathe.";

    } else {
        // Default — let nurse choose which coping tool
        prompt = `A nurse is looking for coping support. They said: "${query}"

    Using conversation history to understand their stressor and energy level:
    1. Validate what they're going through (1 sentence)
    2. Suggest the most relevant option based on what they shared:
    - Feeling anxious/overwhelmed → box breathing
    - Feeling disconnected/scattered → 5-4-3-2-1 grounding
    - Need to process thoughts → journaling prompts
    - Feeling physical tension → body scan
    3. Give ACTUAL step-by-step instructions for whichever you suggest
    4. Ask if they'd like to try it
    Under 150 words.`;
        modeContext = "COPING TOOLS MODE: Match the tool to their state. Practical over vague.";
    }

    return callGemini(prompt, history, modeContext);
    }

    // 3B. SUPPORT TOOLS — Peer Support / External Resources / Closing
    async function handleSupportTools(query, params, history) {
    const isWrappingUp = /bye|thank|that'?s all|i('ll| will) go|feel better|done/i.test(query)
                        || history.length >= 8;

    let prompt = "";
    let modeContext = "";

    if (isWrappingUp) {
        prompt = `A conversation with a nurse is wrapping up. They said: "${query}"

    Using the FULL conversation history:
    1. Briefly reflect 1–2 specific things they shared — show you remember
    2. Acknowledge their strength in reaching out today
    3. Suggest ONE concrete next step tailored to their situation
    (e.g. box breathing before bed, jot in journal, call EAP tomorrow)
    4. End with genuine warm encouragement
    Under 130 words.`;
        modeContext = "CLOSING MODE: Warm, personal, brief. Reference specific things shared. Leave them feeling supported.";

    } else {
        // Resources — peer support, EAP, referrals
        prompt = `A nurse is looking for peer support or external resources. They said: "${query}"

    Using conversation history, make this feel personal — reference what they've shared.
    Frame every resource as a POSITIVE, proactive step — not a red flag:

    1. 💼 Employee Assistance Programme (EAP) — free, confidential, via HR — great first step
    2. 🏥 IMH Community Mental Health — 6389 2200 (Mon–Fri office hours)
    3. 🤝 Singapore Association for Mental Health — 1800-283-7019
    4. 📱 Intellect app — App Store / Google Play — good for daily check-ins
    5. 👩‍⚕️ Singapore Nurses Association (SNA) — sna.org.sg — peer community

    End with: "Reaching out takes courage. You're already doing the hard part."
    Under 160 words.`;
        modeContext = "RESOURCES MODE: Warm and normalising. Personalise to what they shared. This is a strength.";
    }

    return callGemini(prompt, history, modeContext);
    }


    // 4. BURNOUT FLOW — Assessment Questions + Result
    async function handleBurnoutFlow(query, params, history) {
        const isCrisis = /want to die|kill myself|end my life|don't want to live|want to disappear|can't go on|want to hurt myself|ending it|no point living|feel like dying/i.test(query);
        if (isCrisis){
            return handleCrisisSupport(query, params, history)
        }
    const questionNumber = parseInt(params.burnout_question) || 1;
    const runningTotal   = parseInt(params.burnout_running_total) || 0;

    const questions = [
        "How often do you feel emotionally drained by the end of your shift?",
        "How often do you feel like you're just going through the motions — physically present but not really connecting with your patients?",
        "How often does your work feel meaningful and like it's making a real difference?",
        "How often do you find it hard to feel empathy for your patients, even when you want to?",
        "How often do you feel physically exhausted even after a full night's rest?",
    ];

    const scale = "\n*(1 = Rarely · 2 = Sometimes · 3 = Occasionally · 4 = Often · 5 = Always)*";

    // ── Natural language → score map ──────────────────────────────────────────
    const textScoreMap = {
        // Score 1
        "never": 1, "rarely": 1, "almost never": 1, "not really": 1,
        "hardly": 1, "hardly ever": 1,
        // Score 2
        "sometimes": 2, "not often": 2, "once in a while": 2,
        "not frequently": 2,
        // Score 3
        "neutral": 3, "moderate": 3, "moderately": 3,
        "sometimes yes sometimes no": 3, "half the time": 3,
        "depends": 3, "sort of": 3, "somewhat": 3, "occasionally": 3,
        // Score 4
        "often": 4, "frequently": 4, "quite often": 4,
        "most of the time": 4, "a lot": 4, "usually": 4,
        "more often than not": 4,
        // Score 5
        "always": 5, "constantly": 5, "every time": 5, "all the time": 5,
        "every day": 5, "every shift": 5, "non stop": 5, "nonstop": 5,
    };

    // ── Parse score from query ─────────────────────────────────────────────────
    function parseScore(input) {
        const trimmed = input.trim().toLowerCase();

        // Direct digit 1–5
        const numMatch = trimmed.match(/\b([1-5])\b/);
        if (numMatch) return parseInt(numMatch[1]);

        // Written number words
        const wordNumbers = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        for (const [word, val] of Object.entries(wordNumbers)) {
        if (new RegExp(`\\b${word}\\b`).test(trimmed)) return val;
        }

        // Natural language — longest phrase first to avoid partial hits
        const sortedKeys = Object.keys(textScoreMap).sort((a, b) => b.length - a.length);
        for (const phrase of sortedKeys) {
        if (trimmed.includes(phrase)) return textScoreMap[phrase];
        }

        return null; // Truly ambiguous
    }

    // ── Readiness / filler signals — present Q1 without scoring ───────────────
    const isReadySignal = /^(ready|ok|okay|yes|sure|go|start|yep|yeah|let'?s go|alright|fine|okay let's go)$/i.test(query.trim());

    if (isReadySignal || (runningTotal === 0 && questionNumber === 1 && parseScore(query) === null)) {
        const text = await callGemini(
        `A nurse is ready to start their burnout check-in. Present question 1 of 5 warmly and conversationally:
    "${questions[0]}${scale}"
    Brief warm framing before the question (1 sentence max). Under 80 words.`,
        history,
        "BURNOUT ASSESSMENT MODE: Conversational check-in. Not a clinical survey. Always show the 1–5 scale with the question."
        );
        return { text, params: { burnout_question: 1, burnout_running_total: 0 } };
    }

    // ── Parse user's answer ───────────────────────────────────────────────────
    const userScore = parseScore(query);

    // Ambiguous — re-prompt warmly, stay on same question
    if (userScore === null) {
        const text = await callGemini(
        `A nurse gave an unclear answer to a burnout check-in question: "${query}"
    Gently let them know you didn't quite catch that and re-ask the current question:
    "${questions[questionNumber - 1]}${scale}"
    Warm, short, non-judgmental. Under 60 words.`,
        history,
        "BURNOUT CLARIFICATION: Warm re-prompt. Always show 1–5 scale. Never make them feel bad."
        );
        return { text, params: {} }; // No param change — stay on same question
    }

    // ── Q3 is reverse-scored (positive question) ──────────────────────────────
    // "How often does work feel meaningful?" — 5 = very meaningful = LOW burnout
    const adjustedScore = questionNumber === 3 ? (6 - userScore) : userScore;
    const newTotal      = runningTotal + adjustedScore;
    const nextQ         = questionNumber + 1;

    // ── All 5 questions answered → show result immediately ────────────────────
    if (questionNumber >= 5) {
        const severity = newTotal >= 20 ? "high" : newTotal >= 14 ? "moderate" : "mild";
        const recommendations =
        severity === "high"
            ? `1. Please speak to someone soon — contact your hospital's EAP (HR) for a confidential session\n2. Consider reducing overtime if possible, even for one week\n3. IMH outpatient referral via GP — you deserve proper support\n4. You are NOT weak. This is a very human response to an extremely demanding job.`
        : severity === "moderate"
            ? `1. Build one micro-recovery habit this week (5-min walks, journaling, breathing)\n2. Talk to a trusted colleague or use the EAP — even once helps\n3. Intellect app for daily mood tracking and guided exercises\n4. Watch your sleep — even 30 min more makes a real difference`
        : `1. Keep doing what you're doing — you're managing well\n2. Stay connected to your support network at work\n3. Check in with yourself weekly — early awareness is everything\n4. Intellect app is great for maintaining this baseline`;

        const text = await callGemini(
        `A nurse just answered the final (5th) burnout check-in question.
    Start with ONE warm sentence acknowledging their final answer naturally.
    Then immediately transition into their results — total score: ${newTotal}/25, ${severity} burnout risk.

    1. Acknowledge score with compassion — normalise it ("this is incredibly common in nursing")
    2. Validate the courage it took to answer honestly
    3. Share these recommendations warmly, not as warnings:
    ${recommendations}
    4. End with genuine encouragement — they are not alone

    Under 250 words. Warm, personal, hopeful tone. No bridge phrases like "let me calculate" — go straight into the result.`,
        history,
        "BURNOUT RESULT MODE: Final answer + result in one seamless response. Sensitive and empowering."
        );

        // Reset all burnout params — assessment complete
        return { text, params: { burnout_question: 1, burnout_running_total: 0 } };
    }

    // ── Ask next question ─────────────────────────────────────────────────────
    const text = await callGemini(
        `A nurse answered burnout question ${questionNumber} of 5.
    Briefly acknowledge their answer naturally (1 warm sentence — not clinical, don't repeat their exact words back).
    Then present question ${nextQ} of 5:
    "${questions[nextQ - 1]}${scale}"
    Under 80 words total.`,
        history,
        "BURNOUT ASSESSMENT MODE: Conversational. Always include the 1–5 scale label with the question."
    );

    return { text, params: { burnout_question: nextQ, burnout_running_total: newTotal } };
    }





    // 5. CRISIS SUPPORT — All Crisis Signals
    async function handleCrisisSupport(query, params, history) {
    const safetyLines = `\n\nPlease reach out to someone right now — you don't have to face this alone:\n🆘 IMH 24-hour helpline: 6389 2222\n🆘 Samaritans of Singapore (SOS): 1800-221-4444\n🆘 Emergency: 995`;

    if (!query || query.trim().length < 3) {
        return "Your safety matters. I'm here with you." + safetyLines;
    }

    const aiResponse = await callGemini(
        `A nurse may be in crisis. They said: "${query}"

    This is the MOST IMPORTANT response. Using the full conversation history:

    1. IMMEDIATE WARMTH — acknowledge they are heard, not judged
    2. Validate SPECIFICALLY what they said — don't be generic
    3. ONE gentle question only: "Are you safe right now?"
    4. Be PRESENT — no advice, no platitudes, no silver linings
    5. Short and human — under 90 words (safety lines added separately)

    DO NOT include helpline numbers — they will be added automatically.
    DO NOT say "I understand" — show it through specificity.`,
        history,
        "CRISIS MODE — ABSOLUTE HIGHEST PRIORITY. Presence over advice. Warmth over information. Specificity over generic comfort."
    );

    return aiResponse + safetyLines;
    }


    // 6. CLINICAL INFO HANDLERS
    // 1. MEDICATION LOOKUP — dosage, interactions, contraindications
    async function handleMedicationLookup(query, params, history) {
    const hasDose        = /mg|mcg|ml|dose|dosage|how much|unit|kg|weight/i.test(query);
    const hasInteraction = /interact|together|with|combine|mix|safe to give/i.test(query);
    const hasContra      = /contrain|allerg|avoid|should.*(not|n't)|unsafe|precaution/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (hasDose) {
        prompt = `A nurse is asking about medication dosage. They said: "${query}"

    Using conversation history for context (patient age, weight, condition if mentioned):
    1. State the standard adult dose clearly (mg/kg or flat dose as appropriate)
    2. State the paediatric dose if relevant
    3. Flag the safe maximum dose
    4. List 2–3 key administration notes (e.g. give with food, slow IV push)
    5. If dose mentioned by nurse seems outside safe range, flag it clearly with ⚠️
    6. End with: "Always verify against your hospital formulary before administering."

    Format clearly with headers. Under 180 words.
    IMPORTANT: You are a clinical decision support tool, NOT a prescriber. Flag uncertainty and recommend verification.`;
        modeContext = "DOSAGE MODE: Structured, precise, safety-first. Flag any dose concerns clearly with ⚠️.";

    } else if (hasInteraction) {
        prompt = `A nurse is asking about a drug interaction. They said: "${query}"

    1. Identify the drugs involved from the query
    2. State clearly whether the combination is: ✅ Generally safe | ⚠️ Use with caution | ❌ Avoid
    3. Explain the mechanism of the interaction in plain terms (1–2 sentences)
    4. State the clinical risk (e.g. increased bleeding risk, QT prolongation, hypotension)
    5. Suggest monitoring parameters if combination must be used
    6. End with: "Verify with pharmacist or hospital drug reference before administering."

    Under 180 words. Use visual flags (✅ ⚠️ ❌) clearly.`;
        modeContext = "INTERACTION MODE: Clear risk rating first, then mechanism. Visual flags required.";

    } else if (hasContra) {
        prompt = `A nurse is asking about contraindications. They said: "${query}"

    Using conversation history for patient details if mentioned:
    1. List absolute contraindications clearly (label as ❌ ABSOLUTE)
    2. List relative contraindications (label as ⚠️ RELATIVE — use with caution)
    3. Note any specific patient populations at higher risk (elderly, renal/hepatic impairment, pregnancy)
    4. Suggest an alternative drug class if there is a clear contraindication
    5. End with: "Confirm with prescriber if patient has any of the above conditions."

    Under 180 words. Structured and scannable.`;
        modeContext = "CONTRAINDICATION MODE: Absolute vs relative clearly separated. Patient-specific where possible.";

    } else {
        // General medication query — provide full overview
        prompt = `A nurse is asking about a medication. They said: "${query}"

    Provide a structured clinical summary:
    ## [Drug Name] — Quick Reference

    **Indication:** What it's used for (1–2 lines)
    **Standard Dose:** Adult dose | Paediatric dose if relevant
    **Route:** How it's administered
    **Key Contraindications:** Top 2–3 only
    **Common Side Effects:** Top 3–4 (flag any serious ones with ⚠️)
    **Drug Interactions:** 1–2 most clinically significant
    **Nurse Notes:** 1–2 practical administration tips

    End with: "Always verify against your hospital formulary."
    Under 200 words. Use the header structure above exactly.`;
        modeContext = "GENERAL MED LOOKUP: Full structured reference card. Practical, scannable, safety-flagged.";
    }

    return callGemini(prompt, history, modeContext);
    }


    // 2. CLINICAL PROTOCOLS — SOPs, procedures, guidelines
    async function handleClinicalProtocols(query, params, history) {
    const isEmergency = /code|arrest|resus|crash|rapid|emergency|deteriorat|sepsis|shock|stroke/i.test(query);
    const isInfection = /infect|aseptic|sterile|PPE|isolation|contact precaution|droplet|airborne/i.test(query);
    const isProcedure = /insert|catheter|NGT|IV line|cannula|wound|dress|suction|ECG|blood draw|venepuncture/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (isEmergency) {
        prompt = `A nurse needs an emergency protocol. They said: "${query}"

    Provide a fast, numbered step-by-step protocol:
    1. Immediate first action (within 0–1 min)
    2. Alert/escalation step — who to call and how
    3. Steps 3 onwards in chronological order
    4. Key monitoring parameters during the event
    5. Documentation requirement after stabilisation

    Format: numbered steps, short sentences, action verbs. No long paragraphs.
    ⚠️ Flag any time-critical steps in bold.
    Under 200 words. This nurse may be under pressure — keep it fast and scannable.`;
        modeContext = "EMERGENCY PROTOCOL: Fast, numbered, action-first. Time-critical steps bolded. No waffle.";

    } else if (isInfection) {
        prompt = `A nurse is asking about infection control protocol. They said: "${query}"

    Structure the response as:
    **Precaution Level:** Standard / Contact / Droplet / Airborne (state which applies)
    **PPE Required:** List exactly what to wear (gloves, gown, mask type, eye protection)
    **Room Requirement:** Single room / negative pressure / cohorting
    **Key Steps:**
    1. Before patient contact
    2. During care
    3. After patient contact / doffing sequence
    **Common Mistakes to Avoid:** 1–2 points

    Under 180 words. Clear and practical — a nurse should be able to follow this immediately.`;
        modeContext = "INFECTION CONTROL: PPE and precaution level stated first. Doffing sequence included.";

    } else if (isProcedure) {
        prompt = `A nurse is asking about a clinical procedure. They said: "${query}"

    Provide a step-by-step procedural guide:
    **Indication:** When to perform this procedure
    **Equipment Needed:** Bulleted list of items to prepare
    **Procedure Steps:**
    1–N: Clear numbered steps in order
    **Key Safety Checks:** ⚠️ Flag the 2–3 most critical safety points
    **Post-Procedure:** Documentation and monitoring required

    Under 220 words. Practical, sequential, safe.`;
        modeContext = "PROCEDURE MODE: Equipment list first, then numbered steps. Safety checks clearly flagged.";

    } else {
        // General protocol query
        prompt = `A nurse is asking about a clinical guideline or SOP. They said: "${query}"

    Using conversation history for any relevant context:
    1. Identify the protocol topic from the query
    2. Provide a structured summary:
    - Purpose / When this applies
    - Key steps (numbered, action-verbs)
    - Who is responsible at each step
    - Escalation criteria — when to involve a senior/doctor
    - Documentation required
    3. End with: "Refer to your hospital's most current SOP for institution-specific steps."

    Under 200 words. Structured and scannable.`;
        modeContext = "GENERAL PROTOCOL: Structured summary, escalation criteria included, documentation noted.";
    }

    return callGemini(prompt, history, modeContext, 3000);
    }


    // 3. PATIENT HISTORY — summary, care flags, risk alerts
    // 3. PATIENT HISTORY — clinical interpretation, risk flags, shift priorities
    async function handlePatientHistory(query, params, history) {
    const hasData    = /diagnos|admit|allerg|medication|PMH|history|mg|BP|HR|SpO2|temp|kg|weight/i.test(query);
    const wantsFlags = /flag|risk|alert|look out|watch|concern|what.*should|priorities/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (hasData || wantsFlags) {
        prompt = `A nurse has submitted patient data. They provided: "${query}"

    Your job is NOT to repeat back what was given. The nurse already knows the data.
    Your value is clinical interpretation and inference — surface what they need to ACT on.

    ---

    FORMATTING RULES — STRICTLY FOLLOW:
    - Do NOT use markdown syntax (**bold**, *italics*, ## headers, bullet points with *)
    - Use CAPITAL LETTERS for section headers instead of ## 
    - Use plain dashes ( - ) for bullet points
    - Use emoji only for section headers (🚨 ⚠️ 🔍 💊)
    - Separate sections with a blank line
    - Keep each point to 2 lines maximum


    ## 🚨 Critical Alerts
    Check for and flag ONLY issues needing IMMEDIATE action.
    For each alert, state: what the problem is, why it is dangerous, and what to do NOW.

    Check all of the following:
    - Allergy-drug conflict: cross-check EVERY drug against allergies BY DRUG CLASS
    (e.g. amoxicillin = penicillin class, trimethoprim = sulfonamide class)
    - Dangerous drug combinations (e.g. anticoagulant + NSAID, two QT-prolonging drugs)
    - Vitals meeting escalation criteria — if vitals are provided, calculate NEWS2:
        Resp rate / SpO2 / supplemental O2 / temp / systolic BP / HR / consciousness
        Score ≥5 or any single score of 3 = escalate to senior/MET call
    - Unsafe dosing given organ function (CKD, liver failure, elderly)

    If NO critical alerts exist, write: "✅ No immediate critical alerts identified."
    Do NOT invent concerns that aren't supported by the data.

    ---

    ## ⚠️ Active Risk Flags
    List only risks that apply to THIS patient, justified by their data.
    Do NOT list generic nursing risks with no patient-specific link.

    Format each as:
    **[Risk]:** [Why it applies to this patient] → [One specific nursing action]

    Cover relevant categories from:
    - Falls / mobility
    - Pressure injury
    - Aspiration / swallowing
    - Infection precautions
    - Fluid balance
    - Glycaemic control
    - Deterioration trajectory

    ---

    ## 🔍 Shift Priorities
    List 3–5 specific, timed or triggered checks for this shift.
    Each must be directly tied to a clinical reason from the patient data.

    Format:
    - [What to check / do] — [Why, linked to this patient's specific condition or drug]

    Examples of the level of specificity required:
    - "Check BGL at 22:00 and 06:00 — insulin glargine nocte with active fever increases overnight hypoglycaemia risk"
    - "Reassess SpO2 hourly — currently 94% on 2L, NEWS2 suggests close monitoring for deterioration"
    - "Withhold next dose of IV amoxicillin-clavulanate — penicillin allergy conflict, await prescriber review"

    ---

    ## 💊 Medication Watch
    Flag only medications that need active nursing attention.
    Skip routine drugs with no monitoring requirements.

    For each flagged drug:
    **[Drug]:** [Why it needs attention] — [What to monitor or action]

    High-alert drug classes to always flag if present:
    - Insulin / hypoglycaemics
    - Anticoagulants (warfarin, heparin, LMWH, NOACs)
    - Opioids
    - Electrolyte infusions (KCl, MgSO4)
    - Digoxin
    - Drugs requiring renal dose adjustment in CKD/AKI

    Each shift priority must include a time interval or trigger condition 
    (e.g. "every hour", "before next dose", "immediately", "at 22:00").


    ---

    Under 300 words total. Be specific, clinical, and concise.
    If any section has nothing to flag, state that clearly — do not pad.`;

        modeContext = `PATIENT HISTORY MODE: 
    Clinical interpretation ONLY — do not echo input back.
    Every point must be justified by the patient data provided.
    NEWS2 calculation required if vitals present.
    Allergy cross-check by drug class is mandatory.
    Specificity over comprehensiveness — 3 actionable points beats 10 generic ones.`;

    } else {
        // No patient data detected — prompt nurse to share details
        prompt = `A nurse has come to the patient history section but hasn't provided patient data yet. They said: "${query}"

    Respond warmly and ask them to share the patient details you need.
    Be specific about what helps you give the most useful analysis:

    Ask for:
    - Patient demographics (age, sex, ward)
    - Primary diagnosis / reason for admission
    - Past medical history
    - Current medications (with doses if known)
    - Known allergies (and reaction type)
    - Latest vitals if available
    - Any current concerns or reason for the review

    Keep it brief and friendly — 2–3 sentences max, then the list.
    Do NOT use clinical jargon in your ask.`;

        modeContext = "PATIENT HISTORY MODE: No data yet — request specific details warmly. Keep it brief.";
    }

    return callGemini(prompt, history, modeContext, 3000);
    }



    // 4. PATIENT CARE GUIDANCE — communication, de-escalation, difficult situations
    async function handlePatientCare(query, params, history) {
    const isRefusal      = /refus|won't|doesn't want|declin|not cooperat|resist/i.test(query);
    const isAggression   = /aggress|angr|shout|violent|threaten|escalat|upset|difficult/i.test(query);
    const isPaeds        = /child|paed|kid|young|infant|toddler|teenager|adolescent/i.test(query);
    const isEndOfLife    = /palliative|end of life|dying|terminal|comfort care|family grief/i.test(query);
    const isCommunication = /explain|tell|communicate|language|understand|deaf|confused|dementia|cogniti/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (isRefusal) {
        prompt = `A nurse is dealing with a patient who is refusing treatment or medication. They said: "${query}"
    Validation: maximum 1 sentence. Then go straight into guidance.
    Do not say "It's completely understandable" or "I hear you" — vary the language.
    Do not restate what the nurse just told you back to them.

    Using conversation history for patient context:
    1. Validate the nurse's frustration briefly (1 sentence)
    2. Suggest 3 practical approaches in order:
    a. Explore the reason for refusal (suggested questions to ask the patient)
    b. Address the specific concern (fear, side effects, misunderstanding, cultural belief)
    c. Involve family/interpreter/doctor if needed
    3. State the nurse's legal/ethical obligation regarding patient autonomy
    4. Suggest documentation steps
    5. Provide one example of what to say to the patient in plain language

    If the query mentions a dangerous vital sign or lab value, 
    flag escalation to the doctor as a PARALLEL step — 
    not contingent on resolving the refusal first.

    Do not end with "How does that sound?" or any approval-seeking question.
    End with a direct action or a single targeted follow-up question if genuinely needed.


    Under 200 words. Practical and empathetic.`;
        modeContext = "REFUSAL MODE: Explore → Address → Escalate. Patient autonomy respected. Practical scripts included.";

    } else if (isAggression) {
        prompt = `A nurse is managing an agitated or aggressive patient/family member. They said: "${query}"
    Validation: maximum 1 sentence. Then go straight into guidance.
    Do not say "It's completely understandable" or "I hear you" — vary the language.
    Do not restate what the nurse just told you back to them.

    1. Validate the difficulty (1 sentence)
    2. Immediate de-escalation steps:
    - Body language and positioning (don't crowd, stay calm, open posture)
    - Tone and language (low, slow, non-confrontational)
    - Acknowledge feelings: "I can see you're frustrated — let me help"
    3. What NOT to do (2–3 clear points)
    4. Escalation threshold — when to call security or senior staff
    5. Post-incident: debrief and documentation

    Do not end with "How does that sound?" or any approval-seeking question.
    End with a direct action or a single targeted follow-up question if genuinely needed.

    Provide one example of an opening phrase to use with the patient.
    Under 200 words. Calm, tactical, safe.`;
        modeContext = "DE-ESCALATION MODE: Safety first, then de-escalation tactics. Clear escalation threshold stated.";

    } else if (isPaeds) {
        prompt = `A nurse is caring for a paediatric patient. They said: "${query}"
    Validation: maximum 1 sentence. Then go straight into guidance.
    Do not say "It's completely understandable" or "I hear you" — vary the language.
    Do not restate what the nurse just told you back to them.    

    Using conversation history for child's age and situation:
    1. Communication approach tailored to age group:
    - Infant/Toddler (0–3): Engage parents, minimise separation
    - Preschool (3–6): Simple words, play distraction, involve in small choices
    - School-age (6–12): Honest simple explanations, allow questions
    - Adolescent (13+): Address directly, respect privacy, explain reasons
    2. Practical care tip specific to the situation described
    3. How to involve parents/guardians effectively
    4. One thing to avoid with this age group

    Do not end with "How does that sound?" or any approval-seeking question.
    End with a direct action or a single targeted follow-up question if genuinely needed.

    Under 180 words. Warm and child-centred.`;
        modeContext = "PAEDIATRIC CARE: Age-appropriate communication. Parent involvement. Child-centred approach.";

    } else if (isEndOfLife) {
        prompt = `A nurse is caring for a palliative or end-of-life patient. They said: "${query}"
    Validation: maximum 1 sentence. Then go straight into guidance.
    Do not say "It's completely understandable" or "I hear you" — vary the language.
    Do not restate what the nurse just told you back to them.

    Using conversation history:
    1. Validate the emotional weight of this situation (1 sentence — genuine, not robotic)
    2. Practical guidance for:
    - Comfort-focused care priorities (pain, positioning, mouth care, dignity)
    - Communication with patient if conscious (what to say, what not to say)
    - Supporting family members — what they need to hear right now
    3. Signs of imminent death to monitor for (if relevant)
    4. Remind nurse: their presence matters more than any words

    Do not end with "How does that sound?" or any approval-seeking question.
    End with a direct action or a single targeted follow-up question if genuinely needed.

    End with a brief check-in: "How are you doing with all of this?"
    Under 200 words. Gentle, human, and dignified.`;
        modeContext = "END OF LIFE: Comfort-focused, dignified. Support for nurse's emotional state included.";

    } else if (isCommunication) {
        prompt = `A nurse needs help communicating with a patient. They said: "${query}"
    Validation: maximum 1 sentence. Then go straight into guidance.
    Do not say "It's completely understandable" or "I hear you" — vary the language.
    Do not restate what the nurse just told you back to them.

    Using conversation history for patient details:
    1. Identify the communication barrier (language, cognition, hearing, health literacy)
    2. Provide 3–4 specific techniques tailored to that barrier:
    - Language barrier: interpreter service, visual aids, simple English
    - Cognitive impairment/dementia: short sentences, familiar words, calm repetition
    - Low health literacy: teach-back method, no jargon, diagrams
    - Hearing impairment: face them, write key points, hearing loop
    3. One phrase or script example to try right now
    4. When to escalate (formal interpreter, speech therapy referral)

    Do not end with "How does that sound?" or any approval-seeking question.
    End with a direct action or a single targeted follow-up question if genuinely needed.

    Under 180 words. Practical and specific.`;
        modeContext = "COMMUNICATION MODE: Barrier-specific techniques. Teach-back and plain language prioritised.";

    } else {
        // General patient care guidance
        prompt = `A nurse is asking for patient care guidance. They said: "${query}"
    Validation: maximum 1 sentence. Then go straight into guidance.
    Do not say "It's completely understandable" or "I hear you" — vary the language.
    Do not restate what the nurse just told you back to them.

    Using conversation history for patient context:
    1. Acknowledge the specific situation they've described
    2. Provide 3–4 practical, actionable suggestions tailored to their scenario
    3. Flag any safety or escalation considerations with ⚠️
    4. If the situation involves a difficult patient interaction — include one suggested phrase to use
    5. End with a relevant follow-up question to refine the advice further

    Do not end with "How does that sound?" or any approval-seeking question.
    End with a direct action or a single targeted follow-up question if genuinely needed.

    Under 200 words. Practical, empathetic, nurse-first.`;
        modeContext = "PATIENT CARE MODE: Situation-specific guidance. Actionable, not generic. Escalation flagged.";
    }

    return callGemini(prompt, history, modeContext, 3000);
    }


    // 5. PATIENT EDUCATION — condition info, discharge teaching, plain-language materials
    async function handlePatientEducation(query, params, history) {
    const isDischarge    = /discharge|going home|after.*hospital|home care|follow.?up|when to.*return/i.test(query);
    const isMedEducation = /explain.*med|medication.*teach|how.*drug.*work|why.*taking|side effect.*explain/i.test(query);
    const isCondition    = /explain.*to.*patient|what.*is.*|tell.*patient|about.*disease|diagnos.*explain|explain.*condition|what.*does.*mean|how.*explain|help.*understand/i.test(query);
    const isDiet         = /diet|eat|food|nutrition|avoid.*food|meal|fluid|drink/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (isDischarge) {
        prompt = `A nurse needs discharge education materials or instructions. They said: "${query}"

    Validation: 1 sentence maximum, then go straight into content.
    Do not say "It's completely understandable" or "It's thoughtful of you".
    Do not restate what the nurse told you back to them.

    Using conversation history for patient's condition and situation:
    Generate a plain-language discharge summary the nurse can walk through WITH the patient:

    ## Before You Go Home ✅
    **Your Diagnosis:** [1 sentence plain language]
    **Medications:** List name, what it's for, how to take it, and what to watch for
    **What To Do At Home:**
    - Activity level / rest
    - Wound care / dressing changes if relevant
    - Diet / fluid instructions

    ## ⚠️ When To Come Back
    List 4–5 specific warning signs that require immediate return to hospital (tailored to condition)

    ## Follow-Up
    - When to see GP/specialist
    - Any tests or appointments to book

    For post-stent patients on dual antiplatelet therapy (DAPT): 
    always include a specific warning that stopping aspirin or 
    clopidogrel early risks stent thrombosis — this must be explicit, 
    not buried under general medication notes.  


    **Teach-Back Prompt:** End with "Can you tell me in your own words what you'll do if [key warning sign] happens?"

    Under 250 words. Plain English, no medical jargon. Suitable for patient to read.`;
        modeContext = "DISCHARGE MODE: Plain-language, patient-readable. Teach-back included. Warning signs specific to condition.";

    } else if (isMedEducation) {
        prompt = `A nurse needs to explain a medication to a patient. They said: "${query}"

    Validation: 1 sentence maximum, then go straight into content.
    Do not say "It's completely understandable" or "It's thoughtful of you".
    Do not restate what the nurse told you back to them.

    Write a plain-language explanation the nurse can read to or hand to the patient:

    **What this medicine is called:** [Name]
    **Why you are taking it:** [Plain English reason — 1 sentence]
    **How to take it:** [Dose, timing, with/without food]
    **What to expect:** [Normal effects and timeline]
    **Side effects to watch for:** ⚠️ List 3–4, flag which ones need immediate medical attention
    **Important: Do NOT stop taking this medicine without talking to your doctor first.**

    If the medication is warfarin or any anticoagulant:
    - State the target INR range explicitly (warfarin for AFib = 2.0–3.0)
    - Explain what happens if INR is too low (clot risk) and too high (bleeding risk)
    - Name 3 specific vitamin K foods common in Asian diets 
    (kangkong, kailan, broccoli) not just "leafy greens"

    Teach-Back Prompt: "Can you tell me when you'll take this medicine and what you'll do if you feel [side effect]?"

    Under 180 words. Zero jargon. Written as if talking to the patient directly.`;
        modeContext = "MEDICATION EDUCATION: Zero jargon. Patient-direct language. Teach-back prompt included.";

    } else if (isCondition) {
        prompt = `A nurse needs to explain a medical condition to a patient. They said: "${query}"

    Validation: 1 sentence maximum, then go straight into content.
    Do not say "It's completely understandable" or "It's thoughtful of you".
    Do not restate what the nurse told you back to them.

    Write a plain-language explanation suitable for a patient with average health literacy:

    **What is [condition]?**
    1–2 sentences in everyday language. No Latin, no jargon.

    **What is happening in your body?**
    Use an analogy if helpful (e.g. "Your arteries are like pipes...")

    **Why does this matter?**
    What happens if it's not managed (briefly, without causing panic)

    **What can you do about it?**
    3–4 lifestyle or treatment points relevant to the condition

    **Questions to ask your doctor:**
    2–3 suggested questions the patient should ask at their next appointment

    Under 200 words. Warm, reassuring tone — informative without being frightening.`;
        modeContext = "CONDITION EDUCATION: Analogy-first, plain English. Empowering not frightening. Suggested questions included.";

    } else if (isDiet) {
        prompt = `A nurse needs to provide dietary education to a patient. They said: "${query}"

    Validation: 1 sentence maximum, then go straight into content.
    Do not say "It's completely understandable" or "It's thoughtful of you".
    Do not restate what the nurse told you back to them.

    Using conversation history for patient's condition:
    Structure as a simple, practical guide:

    **Your Dietary Goals:**
    [1 sentence explaining why diet matters for their condition]

    **Foods to INCLUDE ✅**
    - List 5–6 specific foods/food groups
    - Briefly explain why each helps

    **Foods to LIMIT or AVOID ❌**
    - List 5–6 specific foods
    - Briefly explain why each is harmful

    IMPORTANT — CKD-SPECIFIC DIETARY RULES:
    - Recommend WHITE rice, white bread, white pasta — NOT whole grains
    (whole grains are high in phosphorus and potassium, harmful in CKD)
    - Always flag THREE nutrients: sodium AND potassium AND phosphorus
    - Do not recommend nuts, seeds, dairy, dark colas, whole grains for CKD patients


    **Practical Tips:**
    - 2–3 simple meal-prep or shopping tips

    **One easy swap to start with:**
    [Single most impactful dietary change they can make today]

    Under 200 words. Practical and specific — not a generic healthy eating pamphlet.`;
        modeContext = "DIETARY EDUCATION: Condition-specific, practical, specific foods named. One actionable starting point.";

    } else {
        // General patient education request
        prompt = `A nurse needs to create patient education content. They said: "${query}"

    Validation: 1 sentence maximum, then go straight into content.
    Do not say "It's completely understandable" or "It's thoughtful of you".
    Do not restate what the nurse told you back to them.

    Using conversation history to understand the patient and their condition:
    1. Identify the topic from the query
    2. Write plain-language patient education content with:
    - What it is (1–2 sentences, no jargon)
    - Why it matters for this patient
    - What to do / how to manage it
    - Warning signs to watch for ⚠️
    - One question to check understanding (teach-back)
    3. If the topic is unclear — ask: "What condition or topic would you like me to create education content for?"

    Under 200 words. Patient-readable, warm, and practical.`;
        modeContext = "PATIENT EDUCATION: Plain language, patient-direct. Teach-back always included. Condition-specific.";
    }

    return callGemini(prompt, history, modeContext, 3000);
    }

    // TASK AUTOMATION HANDLERS
    // 1. SBAR HANDOVER NOTES
    async function handleSBAR(query, params, history) {
    const hasData     = /patient|ward|bed|diagnos|BP|HR|SpO2|temp|mg|allerg|history/i.test(query);
    const wantsFormat = /format|template|how.*write|example|show me/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (hasData) {
        prompt = `FORMATTING RULES:
    Do NOT add any disclaimer or closing note.
    Do NOT use markdown symbols (**bold**, ## headers, *bullets*).
    Use CAPITAL LETTERS for section headers.
    Use plain dashes ( - ) for bullet points.
    Separate each section with a blank line.

    A nurse needs an SBAR handover note generated. They provided: "${query}"

    Generate a complete, structured SBAR handover note the nurse can read out loud or hand over directly.

    SITUATION
    - Patient name, age, sex, ward/bed
    - Primary diagnosis / reason for admission
    - One sentence on why handover is happening now (end of shift, transfer, deterioration)

    BACKGROUND
    - Relevant past medical history (conditions that affect current care)
    - Current medications — flag high-alert drugs with (HIGH ALERT)
    - Known allergies — flag each with (ALLERGY)
    - Relevant recent procedures or events

    ASSESSMENT
    - Current vital signs — if provided, calculate and state NEWS2 score
    - Current clinical status — what is the patient's condition right now
    - Active problems being managed this shift
    - Any concerns or issues that developed during the shift
    - Pending results or investigations

    RECOMMENDATION
    - What the oncoming nurse needs to prioritise in the next shift
    - Any tasks that are outstanding or time-sensitive (with times if known)
    - Escalation criteria — what should trigger calling the doctor
    - One sentence on patient's and family's emotional state if relevant
    Missed doses of HIGH ALERT drugs (anticoagulants, insulin, opioids) 
    must be flagged with (!) in RECOMMENDATION and explicitly state 
    "NOT YET GIVEN" with an action and time.

    End with: "Any questions about Mr/Mrs [name] before I hand over?"

    Under 300 words. Concise, clinical, read-aloud ready.`;

        modeContext = `SBAR MODE: Structured handover note. Read-aloud ready.
    NEWS2 if vitals present. High-alert meds and allergies flagged.
    Recommendation section must include escalation criteria.
    No markdown. No disclaimer.`;

    } else if (wantsFormat) {
        prompt = `FORMATTING RULES:
    Do NOT add any disclaimer or closing note.
    Do NOT use markdown symbols.
    Use CAPITAL LETTERS for section headers.

    A nurse wants to know how to write an SBAR note. They said: "${query}"

    Explain the SBAR format briefly:
    - What SBAR stands for and why it is used
    - What goes in each section (2–3 points per section)
    - One complete example using a fictional patient

    Keep the example realistic — use a common ward scenario (e.g. post-op patient, pneumonia admission).
    Under 250 words.`;

        modeContext = "SBAR FORMAT GUIDE: Brief explanation + realistic example. No markdown.";

    } else {
    prompt = `FORMATTING RULES:
    Do NOT add any disclaimer or closing note.
    Do NOT use markdown symbols.
    Validation: 1 sentence maximum, then go straight into the request.
    Do NOT say "That's a really important task" or "SBAR is a great way to..."
    Do NOT restate what the nurse just said back to them.

    A nurse wants help with a handover note but hasn't provided patient details yet. They said: "${query}"

    Ask them warmly and specifically for what you need.
    Keep it to 1 sentence intro then the list:

    To draft your SBAR note, share these details:
    - Patient name, age, sex, ward and bed number
    - Primary diagnosis / reason for admission
    - Current vital signs if available
    - Any events or concerns from this shift
    - Current medications and allergies
    - Any outstanding tasks or pending results

    Do not add anything after the list.`;

    modeContext = "SBAR MODE: No data yet — request specific details. 1 sentence intro only. No validation padding.";
    }


    return callGemini(prompt, history, modeContext, 3000);
    }


    // 2. INPATIENT TREATMENT SCHEDULE
    async function handleTreatmentSchedule(query, params, history) {
    const hasPatientData = /patient|drug|mg|dose|BD|OD|TDS|QID|nocte|mane|PRN|at \d|am|pm|\d{1,2}:\d{2}/i.test(query);
    const wantsTemplate  = /template|blank|empty|format|how.*use/i.test(query);

    let prompt = "";
    let modeContext = "";

    if (hasPatientData) {
        prompt = `FORMATTING RULES:
    Do NOT add any disclaimer or closing note.
    Do NOT use markdown symbols (**bold**, *italics*).
    Do NOT add any introductory or closing sentences.
    Start your response DIRECTLY with the schedule table.
    Use plain text table format using dashes and pipes.

    ${getTodayContext()}

    A nurse has provided patient and medication data. They provided: "${query}"

    Generate an inpatient treatment schedule for the shift.

    First, extract all patients and their medications from the input.
    Convert all dosing frequencies to specific times using these conventions:
    - OD (once daily) = 08:00
    - BD (twice daily) = 08:00, 20:00
    - TDS (three times daily) = 08:00, 14:00, 20:00
    - QID (four times daily) = 06:00, 12:00, 18:00, 23:59
    - Nocte = 22:00
    - Mane = 08:00
    - PRN = list separately in PRN section below the table

    Produce the schedule in this exact format:

    TIME     | PATIENT        | MEDICATION / TREATMENT                  | NOTES
    ---------|----------------|-----------------------------------------|------------------
    06:00    | [Patient name] | [Drug, dose, route]                     | [Flag if needed]

    Flags to include in NOTES column:
    - (HIGH ALERT) for: insulin, anticoagulants (warfarin, enoxaparin, heparin), opioids, digoxin, KCl, MgSO4
    - (ALLERGY CHECK) if allergy was mentioned for that drug class
    - (RENAL REVIEW) if patient has CKD or AKI and drug needs dose adjustment

    Always flag digoxin as (HIGH ALERT) — narrow therapeutic index drug.

    After the table, add:

    PRN MEDICATIONS
    Patient | Medication | Indication | Max Frequency
    --------|------------|------------|---------------
    [name]  | [drug]     | [when to give] | [interval]

    If any data is ambiguous, state what you assumed at the very end.
    Do not add any other text outside the table and PRN section.`;

        modeContext = `TREATMENT SCHEDULE MODE: Table format only. No intro, no closing text.
    Convert frequencies to clock times. HIGH ALERT flags mandatory for insulin, 
    anticoagulants, opioids, digoxin, KCl. PRN medications in separate section.
    No markdown. No disclaimer.`;

        const scheduleText = await callGemini(prompt, history, modeContext, 2500);
        return { text: scheduleText, pendingEmail: true, emailType: "schedule", };

    } else if (wantsTemplate) {
        prompt = `FORMATTING RULES:
    Do NOT add any disclaimer. Do NOT use markdown symbols.
    Do NOT add any introductory sentences.
    Start directly with the template table.

    A nurse wants a blank treatment schedule template. They said: "${query}"

    Provide this blank template exactly:

    TIME     | PATIENT        | MEDICATION / TREATMENT        | NOTES
    ---------|----------------|-------------------------------|------------------
    06:00    |                |                               |
    08:00    |                |                               |
    10:00    |                |                               |
    12:00    |                |                               |
    14:00    |                |                               |
    16:00    |                |                               |
    18:00    |                |                               |
    20:00    |                |                               |
    22:00    |                |                               |
    24:00    |                |                               |

    PRN MEDICATIONS
    Patient | Medication | Indication | Max Frequency | Last Given
    --------|------------|------------|---------------|----------

    Then add one short line explaining the NOTES flags:
    - (HIGH ALERT) insulin, anticoagulants, opioids, digoxin, KCl
    - (ALLERGY CHECK) known allergy to that drug class
    - (RENAL REVIEW) dose needs checking in CKD or AKI
    - (HOLD) medication withheld — document reason
    - (STAT) give immediately`;

        modeContext = "TEMPLATE MODE: Blank schedule table. All standard time slots. Flag guide after table. No intro text.";

        const templateText = await callGemini(prompt, history, modeContext, 1500);
        return { text: templateText, pendingEmail: false };

    } else {
        prompt = `FORMATTING RULES:
    Do NOT add any disclaimer. Do NOT use markdown symbols.
    1 sentence introduction maximum, then go straight into the list.
    Do NOT say "That's great" or any validation phrase.

    A nurse wants a treatment schedule but has not provided patient data yet. They said: "${query}"

    Ask them for what you need:
    - Patient names or bed numbers
    - Medications with doses and frequencies for each patient
    - Any PRN medications and their indications
    - Any allergies or special flags to note
    - Time range needed (full 24h or specific shift hours)

    Do not add anything after the list.`;

        modeContext = "SCHEDULE MODE: No data yet — request specifics. 1 sentence intro max. No validation padding.";

        const fallbackText = await callGemini(prompt, history, modeContext, 800);
        return { text: fallbackText, pendingEmail: false };
    }
    }



// 3. SCHEDULING AND LEAVE QUERIES
async function handleSchedulingLeave(query, params, history) {

  // ── FIX: catch both "18 April" AND "April 18" formats ──
  const hasDateSignal = /\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*\d{1,2}| \d{1,2}[\/\-]\d{1,2}|\d{4}|next\s+\w+day|from.*to|starting|ends|ending|until|till/i.test(query);

  const isConfirmedLeave = (params.leave_start || params.leave_end) ||(hasDateSignal &&/approved|confirmed|granted|taking leave|have leave|leave on|off on|days off|i am off|my off days|leave date|leave from|leave starting|my leave|ending on|ends on|end date|start.*april|april.*start/i.test(query));

  const isLeave   = !hasDateSignal &&/entitlement|how many days|how much leave|can i apply|when can i|carry forward|leave balance|leave policy|sick leave policy|annual leave|AL\b|MC\b|medical leave/i.test(query);

  const isShift   = /shift|roster|swap|night|morning|afternoon|on call|overtime|replace/i.test(query);

  const isConflict = /overlap|clash|conflict|same day|both.*off|coverage|understaffed/i.test(query);

  let prompt = "";
  let modeContext = "";

  // ── CONFIRMED LEAVE ──────────────────────────────────────────────────────
  if (isConfirmedLeave) {

    // Load any dates already collected in previous turns
    const savedStart = params.leave_start || null;
    const savedEnd   = params.leave_end   || null;

    // Pre-extract dates from full user context using shared helpers
    const allUserText = (history || [])
      .filter(h => h.role === 'user')
      .map(h => getMessageContent(h))
      .join(' ') + ' ' + query;

    const dateMatches = [...allUserText.matchAll(
      /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?/gi
    )].map(m => parseDateMatch(m)).filter(Boolean);

    const extractedStart = dateMatches[0] || null;
    const extractedEnd   = dateMatches[1] || dateMatches[0] || null;

    const resolvedStart = extractedStart || savedStart || null;
    const resolvedEnd   = extractedEnd   || savedEnd   || null;

    const resolvedName = params?.person?.name || params?.nursename || null;

    const updatedParams = {
        leave_start: resolvedStart || '',
        leave_end:   resolvedEnd   || '',
        nursename: resolvedName || '',
    };

    prompt = `STRICT OUTPUT RULES:
Do NOT write any sentences or paragraphs.
Do NOT add any introduction, validation, or closing note.
Start your response DIRECTLY with "LEAVE CONFIRMATION" — nothing before it.
Output ONLY the template below, filled in with the data provided.
The entire response must be under 80 words excluding LEAVE_DATA.

A nurse provided leave details: "${query}"
${resolvedName ? `The nurse's name is ${resolvedName}. Use this for the Nurse field — do NOT leave it blank or ask for it.` : ''}
Use conversation history to fill in any missing fields.
If year is not mentioned, assume 2026.
If start date is missing but end date and total days are given, calculate start date.
${getTodayContext()} Use conversation history to fill in missing fields.

If ANY required field (name, leave type, start date, end date) is still missing after
checking conversation history, ask for ONLY the missing fields in one short sentence.
Do NOT output the template until all fields are known.

If all fields are present, output exactly this and nothing else:

LEAVE CONFIRMATION

Nurse: ${resolvedName || '[name]'}
Leave Type: [type]
Start Date: [DD Month YYYY]
End Date: [DD Month YYYY]
Total Days: [number]

REMINDERS
- Submit leave in HR system if not done
- Arrange handover before leave starts

Return to work: [DD Month YYYY]

LEAVE_DATA: {"nurseName":"[name]","leaveType":"[type]","startDate":"[YYYY-MM-DD]","endDate":"[YYYY-MM-DD]"}`;

    modeContext = `CONFIRMED LEAVE MODE:
Template-only output. No prose. No intro sentence.
Start directly with LEAVE CONFIRMATION.
Check conversation history for missing fields before asking.
Return LEAVE_DATA JSON at end.`;

    const rawResponse = await callGemini(prompt, history, modeContext, 3000);

    const leaveDataMatch = rawResponse.match(/LEAVE_DATA:\s*(\{.*\})/);
    const displayText    = rawResponse.replace(/LEAVE_DATA:.*$/m, "").trim();

    if (leaveDataMatch) {
      try {
        const leaveData = JSON.parse(leaveDataMatch[1]);

        // Use JS-extracted dates if available, else fall back to Gemini output
        const finalStart = resolvedStart || leaveData.startDate;
        const finalEnd   = resolvedEnd   || leaveData.endDate;

        const endDateObj = new Date(finalEnd);
        endDateObj.setDate(endDateObj.getDate() + 1);
        const endParts   = [endDateObj.getFullYear(), endDateObj.getMonth() + 1, endDateObj.getDate()];
        const startParts = finalStart.split("-").map(Number);

        const leaveEvents = [{
          title:      `🌴 ${leaveData.leaveType} — ${leaveData.nurseName || "Leave"}`,
          start:      startParts,
          end:        endParts,
          status:     "CONFIRMED",
          busyStatus: "OOF",
        }];

        return {
          text:         displayText,
          pendingEmail: true,
          emailType:    "leave",
          leaveEvents,
          params:       { leave_start: '', leave_end: '' },
        };

      } catch (e) {
        return { text: displayText, pendingEmail: false, params: updatedParams };
      }
    }

    return { text: rawResponse, pendingEmail: false, params: updatedParams };


  // ── LEAVE POLICY / ENTITLEMENT ────────────────────────────────────────────
  } else if (isLeave) {
    prompt = `FORMATTING RULES:
Do NOT add any disclaimer or closing note.
Do NOT use markdown symbols. Use CAPITAL LETTERS for headers.
Use plain dashes for bullets. 1 sentence validation maximum.

A nurse has a leave entitlement query. They said: "${query}"

Answer their specific question directly, then provide relevant guidance:

ANNUAL LEAVE
- Under 2 years service: typically 14 days per year
- 2–5 years: typically 16 days
- Over 5 years: typically 18 days
- Pro-rated for partial years
- Advance notice: minimum 2–4 weeks, subject to ward coverage
- Carry forward: typically up to 5–10 days — check hospital policy

MEDICAL / SICK LEAVE
- 14 days outpatient MC per year
- Up to 60 days hospitalisation leave
- MC from a registered doctor required

COMPASSIONATE / URGENT LEAVE
- 2–3 days for immediate family bereavement
- Subject to HOD approval

OTHER TYPES
- Maternity / Paternity / Childcare: as per MOM guidelines
- Study leave: subject to hospital policy

End with: "For exact entitlements, check your employment contract or speak to HR directly."
Under 200 words.`;

    modeContext = "LEAVE QUERY MODE: Policy guidance only. Singapore hospital context. No email prompt.";

    const leaveText = await callGemini(prompt, history, modeContext, 1200);
    return { text: leaveText, pendingEmail: false };   // ← no email


  // ── SHIFT / ROSTER ────────────────────────────────────────────────────────
  } else if (isShift) {
    prompt = `FORMATTING RULES:
Do NOT add any disclaimer or closing note.
Do NOT use markdown symbols. Use CAPITAL LETTERS for headers.
Use plain dashes for bullets. 1 sentence validation maximum.

A nurse has a shift or roster query. They said: "${query}"

Address their specific situation, then provide relevant guidance:

SHIFT SWAPS
- Both nurses must agree — written confirmation required
- Submit swap request to charge nurse at least 48–72 hours in advance
- Both nurses must have equivalent ward competency for the shift
- Manager approval required before swap is confirmed

OVERTIME
- Approval from nurse manager required BEFORE working overtime
- Compensated as TOIL or overtime pay per hospital policy
- Maximum consecutive hours limits apply — check your hospital policy

ON-CALL
- Requirements vary by specialty and seniority
- Contact nurse manager for current on-call roster

Under 180 words.`;

    modeContext = "SHIFT QUERY MODE: Practical steps. No email prompt.";

    const shiftText = await callGemini(prompt, history, modeContext, 1200);
    return { text: shiftText, pendingEmail: false };   // ← no email


  // ── SCHEDULING CONFLICT ───────────────────────────────────────────────────
  } else if (isConflict) {
    prompt = `FORMATTING RULES:
Do NOT add any disclaimer or closing note.
Do NOT use markdown symbols. Use CAPITAL LETTERS for headers.
Use plain dashes for bullets.
1 sentence acknowledgement, then go straight into the steps.

A nurse is dealing with a scheduling conflict. They said: "${query}"

RESOLUTION STEPS

1. Check if another nurse can cover voluntarily — ask before escalating
2. Escalate to charge nurse immediately — they have authority to reassign
3. If unresolved, escalate to nurse manager — do not leave ward understaffed
4. Document the situation and resolution in writing
5. Flag to manager how the conflict occurred — prevent recurrence

PATIENT SAFETY
Coverage below minimum safe staffing overrides leave approvals.
The charge nurse or nurse manager can recall approved leave in exceptional circumstances.

Under 160 words.`;

    modeContext = "CONFLICT MODE: Escalation steps. Patient safety priority. No email.";

    const conflictText = await callGemini(prompt, history, modeContext, 1000);
    return { text: conflictText, pendingEmail: false };


  // ── GENERAL / UNCLEAR ─────────────────────────────────────────────────────
  } else {
    prompt = `FORMATTING RULES:
Do NOT add any disclaimer. Do NOT use markdown symbols.
1 sentence maximum before going into the answer.

A nurse has a scheduling or leave query. They said: "${query}"

Using conversation history for context:
1. Identify whether this is about: confirmed leave dates, leave entitlement, shift swaps, overtime, or a scheduling conflict
2. Answer directly based on general Singapore hospital nursing policy
3. If it requires specific hospital policy — direct to HR or nurse manager
4. If unclear — ask one question only:
   "Is this about your leave entitlement, a shift swap, confirmed leave dates, or a scheduling conflict?"

Under 150 words.`;

    modeContext = "SCHEDULING MODE: Identify query type first. One clarifying question if needed. Singapore context. No email.";

    const generalText = await callGemini(prompt, history, modeContext, 800);
    return { text: generalText, pendingEmail: false };
  }
}





    // 4. PATIENT EDUCATION DRAFTS — formatted printable document
    async function handleEducationDraft(query, params, history) {
    const isDischarge  = /discharge|going home|home care|after.*hospital|follow.?up/i.test(query);
    const isMedication = /medication|medicine|drug|tablet|injection|warfarin|insulin|aspirin/i.test(query);
    const isCondition  = /condition|disease|diagnos|diabetes|hypertension|heart|kidney|stroke|asthma|COPD/i.test(query);
    const isDiet       = /diet|eat|food|nutrition|avoid.*food|fluid|drink|meal/i.test(query);

    let prompt = "";
    let modeContext = "";

    const formattingRules = `FORMATTING RULES:
    Do NOT add any disclaimer or closing note.
    Do NOT use markdown symbols (**bold**, ## headers, *bullets*).
    Use CAPITAL LETTERS for section headers.
    Use plain dashes ( - ) for bullet points.
    This is a PRINTABLE DOCUMENT — format for a patient to read independently at home.
    No teach-back prompt — this is a take-home handout, not a verbal walkthrough.
    Separate each section with a blank line.`;

    if (isDischarge) {
        prompt = `${formattingRules}

    A nurse needs a printable discharge education handout. They provided: "${query}"

    Generate a patient-readable discharge handout with these sections:

    PATIENT DISCHARGE GUIDE
    [Hospital name placeholder] | Ward [X] | Date: ___________

    YOUR DIAGNOSIS
    [Plain English, 1–2 sentences. No medical jargon.]

    YOUR MEDICATIONS AT HOME
    For each medication listed:
    - Name and dose
    - What it is for (plain language)
    - When and how to take it
    - One important thing to remember
    Flag DAPT drugs (aspirin + clopidogrel) with: DO NOT STOP without asking your doctor first.

    WHAT TO DO AT HOME
    - Activity level and restrictions
    - Wound care instructions if relevant
    - Diet recommendations
    - Follow-up appointments (with placeholder dates)

    WARNING SIGNS — COME BACK TO HOSPITAL IF:
    List 5–6 specific symptoms that require immediate return.
    Make these condition-specific — not generic.

    YOUR FOLLOW-UP APPOINTMENTS
    - GP: Within ___ days
    - Specialist: Within ___ weeks
    - Bring this sheet to your next appointment.

    Under 350 words. Patient-readable, no jargon.`;

        modeContext = "DISCHARGE DRAFT: Printable handout. Patient reads independently. No teach-back. Condition-specific warning signs.";

    } else if (isMedication) {
        prompt = `${formattingRules}

    A nurse needs a printable medication education handout. They provided: "${query}"

    Generate a patient-readable medication information sheet:

    YOUR MEDICATION GUIDE
    Medication: [Name and dose]
    Date prepared: ___________

    WHAT THIS MEDICINE IS FOR
    [Plain English, 1–2 sentences]

    HOW TO TAKE IT
    - Dose: [amount]
    - When: [timing — morning, night, with food, etc.]
    - How: [tablet, injection, inhaler, etc.]
    - If you miss a dose: [specific instruction]

    WHAT TO EXPECT
    - When it starts working: [timeframe]
    - Common effects you may notice: [list 2–3 normal effects]

    IMPORTANT SIDE EFFECTS — SEE A DOCTOR IF:
    [List 4–5 side effects requiring medical attention, specific to this drug]

    IMPORTANT REMINDERS
    [2–3 drug-specific points — interactions, monitoring, storage]

    If medication is warfarin:
    - State INR target range (2.0–3.0 for AFib, 2.5–3.5 for mechanical valves)
    - Name specific high vitamin K foods common in Singapore diet: kangkong, kailan, broccoli, spinach

    DO NOT stop taking this medicine without speaking to your doctor first.

    Under 280 words. Patient-readable, no jargon.`;

        modeContext = "MEDICATION DRAFT: Printable handout. Singapore-specific food examples for interactions. INR range if warfarin.";

    } else if (isCondition) {
        prompt = `${formattingRules}

    A nurse needs a printable condition education handout. They provided: "${query}"

    Generate a patient-readable condition information sheet:

    UNDERSTANDING YOUR CONDITION
    Condition: [Name]
    Date prepared: ___________

    WHAT IS [CONDITION]?
    [Plain English, 2–3 sentences. Use an analogy if helpful.]
    Example: "Think of your arteries like water pipes..."

    WHAT CAUSES IT?
    [2–3 key causes or risk factors relevant to this patient]

    HOW IT AFFECTS YOUR BODY
    [Simple explanation of what is happening — no Latin terms]

    HOW TO MANAGE IT
    - Medications: [brief — full detail in medication sheet]
    - Lifestyle changes: [list 3–4 specific, actionable points]
    - Monitoring: [what to check and how often — e.g. blood pressure, BGL, weight]

    WARNING SIGNS — SEE A DOCTOR IF:
    [4–5 symptoms specific to this condition]

    LIVING WELL WITH [CONDITION]
    [1–2 sentences of encouragement — realistic and specific, not generic]

    Under 300 words. Warm, reassuring, no jargon.`;

        modeContext = "CONDITION DRAFT: Printable handout. Analogy-first. Specific monitoring instructions. Warm closing.";

    } else if (isDiet) {
        prompt = `${formattingRules}

    A nurse needs a printable dietary education handout. They provided: "${query}"

    Generate a patient-readable dietary guide:

    YOUR DIETARY GUIDE
    Condition: [Condition name]
    Date prepared: ___________

    WHY DIET MATTERS FOR YOU
    [1–2 sentences specific to how diet affects their condition]

    FOODS TO EAT MORE OF
    [List 6–8 specific foods with brief reason for each]
    Use Singapore-familiar foods where possible (e.g. tofu, fish, rice, kangkong)

    FOODS TO LIMIT OR AVOID
    [List 6–8 specific foods with brief reason for each]
    Be condition-specific:
    - Heart failure / hypertension: sodium focus
    - CKD: potassium AND phosphorus AND sodium — recommend WHITE rice over whole grains
    - Diabetes: glycaemic index focus
    - Post-MI: saturated fat and cholesterol focus

    PRACTICAL TIPS FOR SINGAPORE EATING
    - Hawker centre choices: [2–3 specific recommendations]
    - What to order less of: [2–3 specific items]
    - Simple swap to start today: [one specific, easy change]

    YOUR DAILY TARGETS (if applicable)
    - Sodium: less than [X] mg per day
    - Fluid: [X] ml per day if fluid restriction applies

    Under 300 words. Practical and Singapore-context aware.`;

        modeContext = "DIET DRAFT: Printable handout. Singapore-specific foods. CKD = white rice, potassium AND phosphorus flagged. No jargon.";

    } else {
        prompt = `${formattingRules}

    A nurse needs a patient education draft but hasn't specified the topic clearly. They said: "${query}"

    Using conversation history for context:
    1. If you can identify the topic — generate the appropriate handout (discharge / medication / condition / diet)
    2. If the topic is unclear — ask one specific question:
    "What would you like the handout to cover? For example: a condition explanation, medication guide, discharge instructions, or dietary advice?"

    If generating a handout, follow the same printable format — capital headers, plain dashes, patient-readable, no jargon.
    Under 250 words.`;

        modeContext = "EDUCATION DRAFT MODE: Identify topic then generate printable handout. One clarifying question if needed.";
    }

    return callGemini(prompt, history, modeContext, 3500);
    }


    // 5. REMINDERS AND TASK CHECKLISTS
// REMINDER HANDLER — fields persisted in session params, not history
async function handleTaskReminders(query, params, history) {

  // ── Load any fields already collected in previous turns ───────────────────
  const savedFields = {
    task:        params.reminder_task    || null,
    date:        params.reminder_date    || null,
    time:        params.reminder_time    || null,
    patientInfo: params.reminder_patient || null,
    nurseName: params.remindernurse || nurseName || null,
  };

  // ── Extract from current query only ───────────────────────────────────────
  const lastBotMessage = getLastBotMessage(history);
  const currentFields  = extractFromQuery(query, lastBotMessage);

  // ── Merge — current turn wins over saved ──────────────────────────────────
  const fields = {
    task:        currentFields.task        || savedFields.task,
    date:        currentFields.date        || savedFields.date,
    time:        currentFields.time        || savedFields.time,
    patientInfo: currentFields.patientInfo || savedFields.patientInfo,
    nurseName:   currentFields.nurseName   || savedFields.nurseName,
    notes:       null,
  };

  const isPatientReminder = /bed\s*\d+|patient|ward|medication|med\s*round|vitals|obs|check on|dressing|iv|drip|review|escort/i.test(`${query} ${savedFields.task || ""}`);

  // ── Determine missing fields ───────────────────────────────────────────────
  const missing = [];
  if (!fields.task)      missing.push("task");
  if (!fields.date)      missing.push("date");
  if (!fields.time)      missing.push("time");
  if (isPatientReminder && !fields.patientInfo) missing.push("patientInfo");

  // ── Always save current state back to session params ──────────────────────
  const updatedParams = {
    reminder_task:    fields.task        || "",
    reminder_date:    fields.date        || "",
    reminder_time:    fields.time        || "",
    reminder_patient: fields.patientInfo || "",
    reminder_nurse:   fields.nurseName   || "",
  };

  // ── Still missing fields — ask and save progress ──────────────────────────
  if (missing.length > 0) {
    const question = buildMissingFieldQuestion(missing, fields);
    return { text: question, pendingEmail: false, params: updatedParams };
  }

  // ── All fields confirmed — clear reminder params after use ────────────────
  const clearParams = {
    reminder_task: "", reminder_date: "", reminder_time: "",
    reminder_patient: "", reminder_nurse: "",
  };

  const prompt = `Output exactly this template filled with the data below. Nothing else.
No intro. No sentences. Start directly with REMINDER SET.

Data:
- Nurse: ${fields.nurseName || "Not specified"}
- Task: ${fields.task}
- Patient/Bed: ${isPatientReminder ? (fields.patientInfo || "Not specified") : "N/A"}
- Date: ${fields.date}
- Time: ${fields.time}
- Notes: None

REMINDER SET

Nurse: [nurse]
Task: [task]
${isPatientReminder ? "Patient / Bed: [patient]\n" : ""}Date: [date in DD Month YYYY]
Time: [time in HH:MM AM/PM]
Notes: None

This reminder will be added to your calendar with an alert 15 minutes before.`;

  const displayText = await callGemini(prompt, [], "", 1000);

  // ── Build ICS directly from fields — do NOT let Gemini touch date/time ────
  const [year, month, day] = fields.date.split("-").map(Number);
  const [hour, min]        = fields.time.split(":").map(Number);

  const reminderEvents = [{
  title:           `⏰ ${fields.task}${isPatientReminder && fields.patientInfo ? ` — ${fields.patientInfo}` : ""}`,
  start:           [year, month, day, hour, min],
  startInputType:  'local',
  startOutputType: 'local',
  duration:        { minutes: 30 },   // ← keep only this
  description:     "",
  alarms: [{
    action:      "display",
    description: `Reminder: ${fields.task}`,
    trigger:     { minutes: 15, before: true },
  }],
}];


  const reminderData = {
    type:        isPatientReminder ? "patient" : "task",
    task:        fields.task,
    patientInfo: fields.patientInfo || "none",
    date:        fields.date,   // always YYYY-MM-DD
    time:        fields.time,   // always HH:MM (24h)
    nurseName:   fields.nurseName || "Not specified",
    notes:       "none",
  };

  const parsed = {
    text:          displayText.trim(),
    pendingEmail:  true,
    emailType:     "reminder",
    reminderEvents,
    reminderData,
    params:        clearParams,
  };

  return parsed;
}


// EXTRACT FROM CURRENT QUERY ONLY — no history needed
function extractFromQuery(query, lastBotMessage) {
  const fields = {};
  const today  = new Date();

  // ── Context-aware: if bot asked about task, short reply IS the task ────────
  const botAskedTask = /what.*remind.*about|what.*should i remind|what would you like.*reminded/i.test(lastBotMessage);
  if (botAskedTask && query.trim().split(" ").length <= 8) {
    fields.task = query.trim()
      .replace(/^remind(?:er)?\s+(?:me\s+)?(?:to\s+|on\s+|about\s+)?/i, "")
      .trim();
  }

  // ── TASK — "remind me to/on/about..." ─────────────────────────────────────
  if (!fields.task) {
    const taskMatch = query.match(
      /remind(?:er)?\s+(?:me\s+)?(?:to\s+|on\s+|about\s+|on\s+a\s+)?(.+?)(?:\s+(?:by|at|on\s+\d|tomorrow|today|\d{1,2}\s*(?:am|pm|:)).*)?$/i
    );
    if (taskMatch) {
      fields.task = taskMatch[1]
        .replace(/\s+(at|by|on|tomorrow|today)\s+.*/i, "")
        .replace(/\s+\d.*/, "")
        .trim();
    }
  }

  // ── DATE ──────────────────────────────────────────────────────────────────
  if (/tomorrow/i.test(query)) {
    const t = new Date(today);
    t.setDate(today.getDate() + 1);
    fields.date = formatDateYMD(t);
  }
  else if (/\btoday\b/i.test(query)) {
    fields.date = formatDateYMD(today);
  }
  else if (/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(query)) {
    const dayName = query.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)[1];
    fields.date   = formatDateYMD(getNextWeekday(dayName));
  }
  else {
    const dateMatch = query.match(
      /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})?/i
    );
    if (dateMatch) fields.date = parseDateMatch(dateMatch);
  }

  // ── TIME ──────────────────────────────────────────────────────────────────
  const timeMatch =
    query.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i) ||
    query.match(/(\d{1,2})\s*(am|pm)/i)          ||
    query.match(/(\d{2}):(\d{2})/);
  if (timeMatch) fields.time = parseTimeMatch(timeMatch);

  // ── PATIENT / BED ─────────────────────────────────────────────────────────
  const bedMatch = query.match(/bed\s*(\d+)/i);
  if (bedMatch) fields.patientInfo = `Bed ${bedMatch[1]}`;

  if (!fields.patientInfo) {
    const patientMatch = query.match(/(?:for|patient)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (patientMatch) fields.patientInfo = patientMatch[1];
  }

  // ── NURSE NAME ────────────────────────────────────────────────────────────
  const nameMatch =
    query.match(/(?:my name is|i.?m|i am)\s+([A-Z][a-z]+)/i) ||
    query.match(/name(?:\s+is)?\s+([A-Z][a-z]+)/i);
  if (nameMatch) fields.nurseName = nameMatch[1];

  return fields;
}


// MISSING FIELD QUESTION BUILDER
function buildMissingFieldQuestion(missing, fields) {
  if (missing.includes("task") && missing.includes("date") && missing.includes("time")) {
    return "What would you like to be reminded about, and when?";
  }
  if (missing.includes("task") && missing.includes("date")) {
    return "What should I remind you about, and on what date?";
  }
  if (missing.includes("task") && missing.includes("time")) {
    return `What should I remind you about, and at what time on ${formatDateDisplay(fields.date)}?`;
  }
  if (missing.includes("task")) {
    return `What should I remind you about on ${formatDateDisplay(fields.date)} at ${formatTimeDisplay(fields.time)}?`;
  }
  if (missing.includes("date") && missing.includes("time")) {
    return "What date and time should I set this reminder for?";
  }
  if (missing.includes("date")) {
    return "What date should I set this reminder for?";
  }
  if (missing.includes("time")) {
    return `What time on ${formatDateDisplay(fields.date)}?`;
  }
  if (missing.includes("patientInfo")) {
    return "Which patient or bed number is this for?";
  }
  return "Could you share a bit more detail?";
}


// HELPERS
