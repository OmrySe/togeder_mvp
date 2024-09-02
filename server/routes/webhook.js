import express from 'express';
import crypto from 'crypto';
import { handleError, sanitize } from '../helpers/routing.js';
import { zoomApp } from '../config.js';
import db from '../helpers/database.js';

const router = express.Router();

function calculateTalkTime(transcript) {
    const talkTime = {};
    let totalDuration = 0;

    try {
        transcript.forEach((utterance) => {
            if (
                utterance.is_final &&
                utterance.words &&
                utterance.words.length > 0
            ) {
                const speaker = utterance.speaker || 'Unknown';
                const duration =
                    utterance.words[utterance.words.length - 1].end_time -
                    utterance.words[0].start_time;

                if (duration > 0) {
                    talkTime[speaker] = (talkTime[speaker] || 0) + duration;
                    totalDuration += duration;
                }
            }
        });

        // Calculate percentages
        Object.keys(talkTime).forEach((speaker) => {
            talkTime[speaker] = (talkTime[speaker] / totalDuration) * 100;
        });
    } catch (error) {
        console.error('Error calculating talk time:', error);
    }

    return talkTime;
}

router.post('/transcription', async (req, res, next) => {
    try {
        sanitize(req);

        if (
            !crypto.timingSafeEqual(
                Buffer.from(req.query.secret, 'utf8'),
                Buffer.from(zoomApp.webhookSecret, 'utf8')
            )
        ) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log('transcription webhook received: ', req.body);

        const { bot_id, transcript } = req.body.data;

        if (!db.transcripts[bot_id]) {
            db.transcripts[bot_id] = [];
        }

        if (!db.talkTime[bot_id]) {
            db.talkTime[bot_id] = {};
        }

        db.transcripts[bot_id].push(transcript);

        // Calculate talk time periodically (e.g., every 10 transcripts)
        if (db.transcripts[bot_id].length % 10 === 0) {
            const talkTime = calculateTalkTime(db.transcripts[bot_id]);
            db.talkTime[bot_id] = talkTime;
        }

        res.status(200).json({ success: true });
    } catch (e) {
        next(handleError(e));
    }
});

router.post('/events', async (req, res, next) => {
    try {
        sanitize(req);

        if (
            !crypto.timingSafeEqual(
                Buffer.from(req.query.secret, 'utf8'),
                Buffer.from(zoomApp.webhookSecret, 'utf8')
            )
        ) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log(
            'Event webhook received:',
            JSON.stringify(req.body, null, 2)
        );

        const { bot_id, event_type, data } = req.body;

        if (!db.participants[bot_id]) {
            db.participants[bot_id] = {};
        }

        switch (event_type) {
            case 'bot.participant_join':
                console.log(`Participant joined: ${data.name} (${data.id})`);
                db.participants[bot_id][data.id] = {
                    name: data.name,
                    joinTime: new Date(),
                    talkTime: 0,
                    isHost: data.is_host,
                };
                break;
            case 'bot.participant_leave':
                console.log(`Participant left: ${data.id}`);
                delete db.participants[bot_id][data.id];
                break;
            case 'bot.active_speaker_start':
                if (db.participants[bot_id][data.id]) {
                    console.log(
                        `Active speaker start: ${data.name} (${data.id})`
                    );
                    db.participants[bot_id][data.id].talkStartTime = new Date();
                }
                break;
            case 'bot.active_speaker_end':
                if (db.participants[bot_id][data.id]) {
                    console.log(
                        `Active speaker end: ${data.name} (${data.id})`
                    );
                    const participant = db.participants[bot_id][data.id];
                    if (participant.talkStartTime) {
                        const talkDuration =
                            (new Date() - participant.talkStartTime) / 1000;
                        participant.talkTime =
                            (participant.talkTime || 0) + talkDuration;
                        delete participant.talkStartTime;
                    }
                }
                break;
            default:
                console.log(`Unhandled event type: ${event_type}`);
        }

        console.log(
            'Updated participants:',
            JSON.stringify(db.participants[bot_id], null, 2)
        );

        res.status(200).json({ success: true });
    } catch (e) {
        console.error('Error in events webhook:', e);
        next(handleError(e));
    }
});

router.post('/chat', async (req, res, next) => {
    console.log('Received chat webhook');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    try {
        const { bot_id, message } = req.body;

        if (!db.chat[bot_id]) {
            db.chat[bot_id] = [];
        }

        db.chat[bot_id].push(message);

        console.log(`Received chat message for bot ${bot_id}:`, message);

        res.status(200).json({ success: true });
    } catch (e) {
        console.error('Error in chat webhook:', e);
        next(handleError(e));
    }
});

export default router;
