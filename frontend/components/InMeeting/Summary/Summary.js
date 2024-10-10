import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './Summary.css';

export const Summary = ({ transcript = [], botId, onSummarize }) => {
    const [summaryState, setSummaryState] = useState('none');
    const [prompt, setPrompt] = useState('general_summary');
    const [summary, setSummary] = useState('');
    const [customPrompt, setCustomPrompt] = useState(''); // New state for custom prompt

    const generateSummary = async () => {
        setSummaryState('summarising');
        try {
            console.log('Generating summary with:', {
                botId,
                prompt,
                customPrompt,
            });
            const newSummary = await onSummarize(botId, prompt, customPrompt);
            console.log('Received summary:', newSummary);
            setSummary(newSummary);
            setSummaryState('none');
        } catch (error) {
            console.error('Error generating summary:', error);
            setSummaryState('error');
        }
    };

    return (
        <div className="InMeeting-summary">
            <h3>AI Summary</h3>
            <p className="InMeeting-summary-text">{summary}</p>
            <select value={prompt} onChange={(e) => setPrompt(e.target.value)}>
                <option value="general_summary">Summarize this meeting</option>
                <option value="action_items">Generate action items</option>
                <option value="decisions">Outline decisions made</option>
                <option value="participants_opinions">
                    See participants opinions
                </option>
                <option value="ask_anything">Ask anything</option>
            </select>
            {/* if prompt is ask_anything, show input field for custom prompt */}
            {prompt === 'ask_anything' && (
                <input
                    type="text"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Enter your question..."
                />
            )}
            <button
                onClick={generateSummary}
                disabled={
                    transcript.length === 0 ||
                    ['summarising', 'error'].includes(summaryState) ||
                    (prompt === 'ask_anything' && !customPrompt.trim()) // Disable if 'ask_anything' is selected and customPrompt is empty
                }
            >
                {summaryState === 'none' && 'Ask AI'}
                {summaryState === 'summarising' && 'Thinking...'}
                {summaryState === 'error' && 'An Error Occurred'}
            </button>
        </div>
    );
};

Summary.propTypes = {
    transcript: PropTypes.array,
    botId: PropTypes.string.isRequired,
    onSummarize: PropTypes.func.isRequired,
};

export default Summary;
