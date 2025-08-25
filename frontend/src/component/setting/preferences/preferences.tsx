import { useState } from 'react'

const Preferences = () => {
    const [language, setLanguage] = useState("English");
    const [currency, setCurrency] = useState("USD");
    return (
        <>
            <h3 className="setting-section-title">Preferences</h3>

            <div className="setting-row">
                <p className="setting-row-label">Language</p>
                <div className="setting-row-value">
                    <select
                        className="setting-select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        aria-label="Select language"
                    >
                        <option>English</option>
                        <option>Thai</option>
                        <option>Japanese</option>
                    </select>
                </div>
            </div>

            <div className="setting-row">
                <p className="setting-row-label">Currency</p>
                <div className="setting-row-value">
                    <select
                        className="setting-select"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        aria-label="Select currency"
                    >
                        <option>USD</option>
                        <option>THB</option>
                        <option>EUR</option>
                        <option>JPY</option>
                    </select>
                </div>
            </div>
        </>
    )
}

export default Preferences