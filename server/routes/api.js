import express from 'express';
import { handleError, sanitize } from '../helpers/routing.js';
import { contextHeader, getAppContext } from '../helpers/cipher.js';
import { recallFetch } from '../helpers/recall.js';

import session from '../session.js';
import { zoomApp } from '../config.js';
import db from '../helpers/database.js';
import { anthropicFetch } from '../helpers/anthropic.js';

const router = express.Router();

/*
 * Gets the context of the Zoom App
 */
router.get('/context', async (req, res, next) => {
    try {
        sanitize(req);

        const header = req.header(contextHeader);

        const isZoom = !!(header && getAppContext(header));

        return res.json({
            isZoom,
        });
    } catch (e) {
        next(handleError(e));
    }
});

const validateAppContext = (req) => {
    const header = req.header(contextHeader);

    if (!header || !getAppContext(header)) {
        const e = new Error('Unauthorized');
        e.code = 401;
        throw e;
    }
};

/*
 * Send's a Recall Bot to start recording the call
 */
router.post('/start-recording', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        if (!req.body.meetingUrl) {
            return res.status(400).json({ error: 'Missing meetingUrl' });
        }

        console.log('recall bot start recording', req.body.meetingUrl);

        // @see https://recallai.readme.io/reference/bot_create
        const bot = await recallFetch('/api/v1/bot', {
            method: 'POST',
            body: JSON.stringify({
                bot_name: `${process.env.BOT_NAME} #`,
                meeting_url: req.body.meetingUrl,
                transcription_options: {
                    provider: 'default',
                },
                real_time_transcription: {
                    destination_url: `${zoomApp.publicUrl}/webhook/transcription?secret=${zoomApp.webhookSecret}`,
                    partial_results: true,
                },
                zoom: {
                    request_recording_permission_on_host_join: true,
                    require_recording_permission: true,
                },
                real_time_media: {
                    webhook_call_events_destination_url: `${zoomApp.publicUrl}/webhook/events?secret=${zoomApp.webhookSecret}`,
                    webhook_chat_messages_destination_url: `${zoomApp.publicUrl}/webhook/chat?secret=${zoomApp.webhookSecret}`,
                },
            }),
        });

        console.log('recall bot', bot);
        req.session.botId = bot.id;

        return res.json({
            botId: bot.id,
        });
    } catch (e) {
        next(handleError(e));
    }
});

/*
 * Tells the Recall Bot to stop recording the call
 */
router.post('/stop-recording', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        const botIds = req.session.botIds || [];

        if (botIds.length === 0) {
            return res.status(400).json({ error: 'No active bots' });
        }

        await Promise.all(
            botIds.map(async (botId) => {
                await recallFetch(`/api/v1/bot/${botId}/leave_call`, {
                    method: 'POST',
                });
            })
        );

        // Clear bot data
        db.transcripts = {};
        req.session.botIds = [];

        console.log('All recall bots stopped');
        return res.json({ success: true });
    } catch (e) {
        next(handleError(e));
    }
});

/*
 * Adds multiple Recall Bots to start recording the call
 */
router.post('/add-bots', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        if (!req.body.meetingUrl || !req.body.botCount) {
            return res
                .status(400)
                .json({ error: 'Missing meetingUrl or botCount' });
        }

        const botCount = parseInt(req.body.botCount);
        const totalBots = parseInt(req.body.totalBots) || 0;
        const bots = [];

        for (let i = 0; i < botCount; i++) {
            const botNumber = totalBots + i + 1;
            const bot = await recallFetch('/api/v1/bot', {
                method: 'POST',
                body: JSON.stringify({
                    bot_name: `${process.env.BOT_NAME} # ${botNumber}`,
                    meeting_url: req.body.meetingUrl,
                    transcription_options: {
                        provider: 'gladia',
                        detect_language: false,
                        language: 'he',
                    },
                    real_time_transcription: {
                        destination_url: `${zoomApp.publicUrl}/webhook/transcription?secret=${zoomApp.webhookSecret}`,
                        partial_results: true,
                    },
                    zoom: {
                        request_recording_permission_on_host_join: true,
                        require_recording_permission: true,
                    },
                    real_time_media: {
                        webhook_call_events_destination_url: `${zoomApp.publicUrl}/webhook/events?secret=${zoomApp.webhookSecret}`,
                        webhook_chat_messages_destination_url: `${zoomApp.publicUrl}/webhook/chat?secret=${zoomApp.webhookSecret}`,
                    },
                }),
            });

            console.log(`recall bot ${botNumber}`, bot);
            bots.push(bot);

            if (!req.session.botIds) {
                req.session.botIds = [];
            }
            req.session.botIds.push(bot.id);
            db.participants[bot.id] = {}; // Initialize participants object for this bot
        }

        const newTotalBots = totalBots + botCount;

        return res.json({
            bots: bots.map((bot) => ({
                id: bot.id,
                transcript: [],
                summary: '',
            })),
            totalBots: newTotalBots,
        });
    } catch (e) {
        next(handleError(e));
    }
});

/*
 * Gets the current state of all Recall Bots
 */
router.get('/recording-state', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        const botIds = req.session.botIds || [];

        if (botIds.length === 0) {
            return res.json({
                state: 'stopped',
                bots: [],
            });
        }

        const botsData = await Promise.all(
            botIds.map(async (botId) => {
                const bot = await recallFetch(`/api/v1/bot/${botId}`);
                const latestStatus = bot.status_changes.slice(-1)[0].code;

                console.log(`Bot ${botId} status: ${latestStatus}`);

                const participants = bot.meeting_participants || [];
                const talkTime = db.talkTime[botId] || {};

                const participantsWithTalkTime = participants.map((p) => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.is_host,
                    talkTime: talkTime[p.name] || 0,
                    talkTimePercentage: (talkTime[p.name] || 0).toFixed(2),
                }));

                console.log(
                    'Participants with talk time:',
                    JSON.stringify(participantsWithTalkTime, null, 2)
                );

                return {
                    id: botId,
                    state: latestStatus,
                    transcript: db.transcripts[botId] || [],
                    participants: participantsWithTalkTime,
                    meeting_metadata: bot.meeting_metadata,
                };
            })
        );

        const states = botsData.map((bot) => bot.state);
        console.log('All bot states:', states);

        const overallState = determineOverallState(states);
        console.log('Overall state:', overallState);

        return res.json({
            state: overallState,
            bots: botsData,
        });
    } catch (e) {
        console.error('Error in recording-state:', e);
        next(handleError(e));
    }
});

// Helper function to determine overall state
function determineOverallState(states) {
    if (states.length === 0) return 'stopped';
    if (
        states.some(
            (state) => state === 'in_call_recording' || state === 'recording'
        )
    )
        return 'recording';
    if (
        states.some((state) => state === 'starting' || state === 'joining_call')
    )
        return 'starting';
    if (
        states.some((state) => state === 'stopping' || state === 'leaving_call')
    )
        return 'stopping';
    if (states.every((state) => state === 'stopped' || state === 'left_call'))
        return 'stopped';
    if (states.some((state) => state === 'error')) return 'error';
    return 'unknown';
}

const PROMPTS = {
    _template: `
Human: You are a virtual assistant, and you are taking notes for a meeting. 
You are diligent, polite and slightly humerous at times.
Human: Here is the a transcript of the meeting, including the speaker's name:

Human: <transcript>
{{transcript}}
Human: </transcript>

Human: Only answer the following question directly, do not add any additional comments or information. if the trancript is in hebrew, answer in hebrew.
Human: {{prompt}}

Assistant:`,
    general_summary: 'Can you summarize the meeting? Please be concise.',
    action_items: 'What are the action items from the meeting?',
    decisions: 'What decisions were made in the meeting?',
    next_steps: 'What are the next steps?',
    key_takeaways: 'What are the key takeaways?',
};

/*
 * Gets a summary of the transcript using Anthropic's Claude model.
 */
router.post('/summarize', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        const { botId, prompt } = req.body;

        if (!botId || !prompt) {
            return res.status(400).json({ error: 'Missing botId or prompt' });
        }

        const transcript = db.transcripts[botId] || [];
        const finalTranscript = transcript
            .filter((utterance) => utterance.is_final)
            .map(
                (utterance) =>
                    `Human: ${utterance.speaker || 'Unknown'}: ${utterance.words
                        .map((w) => w.text)
                        .join(' ')}`
            )
            .join('\n');
        const completePrompt = PROMPTS._template
            .replace('{{transcript}}', finalTranscript)
            .replace('{{prompt}}', PROMPTS[prompt]);

        console.log('completePrompt', completePrompt);

        const data = await anthropicFetch('/v1/messages', {
            method: 'POST',
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20240620',
                max_tokens: 1024,
                messages: [{ role: 'user', content: completePrompt }],
            }),
        });

        return res.json({
            summary: data.content[0].text,
        });
    } catch (e) {
        next(handleError(e));
    }
});

router.post('/clear-bots', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        // Clear bot data from the database
        db.transcripts = {};
        req.session.botIds = [];

        res.json({ success: true });
    } catch (e) {
        next(handleError(e));
    }
});

router.post('/reset-bots', session, async (req, res, next) => {
    try {
        sanitize(req);
        validateAppContext(req);

        // Reset bot data but keep the bot entries
        for (let botId in db.transcripts) {
            db.transcripts[botId] = [];
        }
        for (let botId in db.participants) {
            db.participants[botId] = [];
        }
        for (let botId in db.talkTime) {
            db.talkTime[botId] = {};
        }

        // Fetch the updated bot data
        const botIds = req.session.botIds || [];
        const bots = botIds.map((id) => ({
            id,
            transcript: db.transcripts[id] || [],
            participants: db.participants[id] || [],
            talkTime: db.talkTime[id] || {},
        }));

        return res.json({ success: true, bots });
    } catch (e) {
        next(handleError(e));
    }
});

export default router;
