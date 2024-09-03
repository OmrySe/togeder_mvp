import React, { useEffect, useState } from 'react';
import './InMeeting.css';
import Transcript from './Transcript/Transcript.js';
import zoomSdk from '@zoom/appssdk';
import appFetch from '../../helpers/fetch';
import Summary from './Summary/Summary';

function InMeeting() {
    const [recordingState, setRecordingState] = useState('stopped');
    const [botCount, setBotCount] = useState(1);
    const [botData, setBotData] = useState([]);
    const [totalBots, setTotalBots] = useState(0);
    const [expandedBots, setExpandedBots] = useState({});

    const addBots = async () => {
        setRecordingState('starting');
        const meetingUrl = await zoomSdk.getMeetingJoinUrl();
        const res = await appFetch('/api/add-bots', {
            method: 'POST',
            body: JSON.stringify({
                meetingUrl: meetingUrl.joinUrl,
                botCount: botCount,
                totalBots: totalBots,
            }),
        });

        if (res.status <= 299) {
            const data = await res.json();
            setBotData((prevBotData) => [...prevBotData, ...data.bots]);
            setTotalBots(data.totalBots);
            setRecordingState('recording');
        } else {
            setRecordingState('error');
        }
    };

    const stopRecording = async () => {
        setRecordingState('stopping');
        const res = await appFetch('/api/stop-recording', { method: 'POST' });

        if (res.status <= 299) {
            setRecordingState('stopped');
            setBotData([]);
            setTotalBots(0);
        } else {
            setRecordingState('error');
        }
    };

    const refreshState = async () => {
        const res = await appFetch('/api/recording-state', { method: 'GET' });

        if (res.status === 400) {
            setRecordingState('stopped');
            return;
        }

        const { state, bots } = await res.json();
        console.log('Received state:', state);
        console.log('Received bots data:', JSON.stringify(bots, null, 2));
        setRecordingState(state);
        setBotData(bots);
    };

    useEffect(() => {
        refreshState();
        const interval = setInterval(refreshState, 5000);
        return () => clearInterval(interval);
    }, []);

    const toggleBotExpansion = (botId) => {
        setExpandedBots((prev) => ({
            ...prev,
            [botId]: !prev[botId],
        }));
    };

    const summarizeTranscript = async (botId, prompt) => {
        const res = await appFetch('/api/summarize', {
            method: 'POST',
            body: JSON.stringify({
                botId: botId,
                prompt: prompt,
            }),
        });

        if (res.status <= 299) {
            const data = await res.json();
            setBotData((prevBotData) =>
                prevBotData.map((bot) =>
                    bot.id === botId ? { ...bot, summary: data.summary } : bot
                )
            );
            return data.summary;
        } else {
            throw new Error('Failed to generate summary');
        }
    };

    const clearBots = async () => {
        const res = await appFetch('/api/clear-bots', { method: 'POST' });
        if (res.status <= 299) {
            setBotData([]);
            setTotalBots(0);
        }
    };

    const resetBots = async () => {
        const res = await appFetch('/api/reset-bots', { method: 'POST' });
        if (res.status <= 299) {
            const data = await res.json();
            setBotData(data.bots);
            setRecordingState('stopped');
        }
    };

    return (
        <div className="InMeeting">
            <header>
                <h1>
                    <span className="black-text">tog</span>
                    <span className="purple-text">ED</span>
                    <span className="black-text">er</span>
                </h1>
            </header>

            <div className="InMeeting-controls">
                <div className="bot-control">
                    <label htmlFor="botCount">Number of Bots to Add:</label>
                    <input
                        id="botCount"
                        type="number"
                        min="1"
                        max="10"
                        value={botCount}
                        onChange={(e) => setBotCount(parseInt(e.target.value))}
                    />
                </div>
                <button
                    className="add-bots-button"
                    onClick={addBots}
                    disabled={recordingState !== 'stopped'}
                >
                    Add Bots
                </button>
                <button
                    className="stop-recording-button"
                    onClick={stopRecording}
                    disabled={recordingState !== 'recording'}
                >
                    Stop Recording
                </button>
                <div>Total Bots: {totalBots}</div>
                <div>Recording State: {recordingState}</div>
                <button onClick={clearBots}>Clear All Bots</button>
                <button onClick={resetBots}>Reset All Bots</button>
            </div>

            {botData.map((bot, index) => (
                <div key={bot.id} className="bot-data">
                    <h3>Bot {index + 1}</h3>
                    <button
                        className="toggle-transcript-button"
                        onClick={() => toggleBotExpansion(bot.id)}
                    >
                        {expandedBots[bot.id] ? 'Hide' : 'Show'} Transcript and
                        Summary
                    </button>
                    {expandedBots[bot.id] && (
                        <>
                            <h4>Transcript</h4>
                            <div className="bot-transcript">
                                <Transcript transcript={bot.transcript} />
                            </div>
                            <h4>Summary</h4>
                            <div className="bot-summary">
                                <Summary
                                    transcript={bot.transcript}
                                    botId={bot.id}
                                    onSummarize={summarizeTranscript}
                                />
                            </div>
                            <h4>Active Participants</h4>
                            <div className="bot-participants">
                                {bot.participants &&
                                bot.participants.length > 0 ? (
                                    <ul>
                                        {bot.participants
                                            .filter(
                                                (p) => p.talkTimePercentage > 0
                                            )
                                            .map((p) => (
                                                <li key={p.id}>
                                                    {p.name}{' '}
                                                    {p.isHost ? '(Host)' : ''}:{' '}
                                                    {Math.round(
                                                        p.talkTimePercentage
                                                    )}
                                                    %
                                                </li>
                                            ))}
                                    </ul>
                                ) : (
                                    <p>No active participants</p>
                                )}
                            </div>
                        </>
                    )}
                </div>
            ))}
        </div>
    );
}

export default InMeeting;
