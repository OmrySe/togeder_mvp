import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './Summary.css';

export const Summary = ({ transcript = [], botId, onSummarize }) => {
    const [summaryState, setSummaryState] = useState('none');
    const [prompt, setPrompt] = useState('general_summary');
    const [summary, setSummary] = useState('');

    const generateSummary = async () => {
        setSummaryState('summarising');
        try {
            const newSummary = await onSummarize(botId, prompt);
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
                <option value="next_steps">Highlight next steps</option>
                <option value="key_takeaways">Find key takeaways</option>
            </select>
            <button
                onClick={generateSummary}
                disabled={
                    transcript.length === 0 ||
                    ['summarising', 'error'].includes(summaryState)
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
