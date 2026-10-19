import React, { useState, useRef } from 'react';
import Vapi from '@vapi-ai/web';

const VapiTest = () => {
    const [publicKey, setPublicKey] = useState(import.meta.env.VITE_VAPI_PUBLIC_KEY || "");
    const [assistantId, setAssistantId] = useState("4e176c4a-d5f7-4e6c-8e7c-5b3f2a1d9e8c");
    const [status, setStatus] = useState("idle");
    const [logs, setLogs] = useState([]);
    const vapiRef = useRef(null);

    const addLog = (msg) => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [`[${time}] ${msg}`, ...prev]);
        console.log(`[VapiTest] ${msg}`);
    };

    const initVapi = () => {
        try {
            if (vapiRef.current) {
                vapiRef.current.stop();
                vapiRef.current = null;
            }

            addLog(`Initializing Vapi with Key: ${publicKey}`);
            const vapi = new Vapi(publicKey);
            vapiRef.current = vapi;

            vapi.on('call-start', () => {
                setStatus("connected");
                addLog("Call Started Successfully!");
            });

            vapi.on('call-end', () => {
                setStatus("disconnected");
                addLog("Call Ended.");
            });

            vapi.on('error', (e) => {
                setStatus("error");
                addLog(`ERROR: ${JSON.stringify(e)}`);
            });

            addLog("Vapi Initialized.");
        } catch (e) {
            addLog(`Init Error: ${e.message}`);
        }
    };

    const handleStart = async () => {
        if (!vapiRef.current) initVapi();

        setStatus("connecting");
        addLog(`Attempting to connect to Assistant ID: ${assistantId}`);

        try {
            await vapiRef.current.start(assistantId);
        } catch (e) {
            setStatus("error");
            addLog(`Start Error: ${e.message}`);
            addLog(`Full Error: ${JSON.stringify(e)}`);
        }
    };

    const handleStop = () => {
        if (vapiRef.current) {
            vapiRef.current.stop();
            addLog("Stopped.");
        }
    };

    return (
        <div className="p-4 sm:p-8 max-w-2xl mx-auto font-mono text-sm">
            <h1 className="text-2xl font-bold mb-6">VAPI Connection Diagnostic</h1>

            <div className="space-y-4 mb-8">
                <div>
                    <label className="block font-bold mb-1">Public Key</label>
                    <input
                        className="w-full p-2 border rounded"
                        value={publicKey}
                        onChange={e => setPublicKey(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block font-bold mb-1">Assistant ID</label>
                    <input
                        className="w-full p-2 border rounded"
                        value={assistantId}
                        onChange={e => setAssistantId(e.target.value)}
                    />
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={handleStart}
                        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold"
                        disabled={status === 'connecting' || status === 'connected'}
                    >
                        {status === 'connecting' ? 'Connecting...' : 'Test Connection'}
                    </button>

                    <button
                        onClick={handleStop}
                        className="px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-bold"
                        disabled={status === 'idle'}
                    >
                        Stop Call
                    </button>
                </div>
            </div>

            <div className="bg-black text-green-400 p-4 rounded h-96 overflow-y-auto">
                <div className="mb-2 border-b border-gray-700 pb-2 flex justify-between">
                    <span className="font-bold">LOGS</span>
                    <button onClick={() => setLogs([])} className="text-xs hover:text-white">Clear</button>
                </div>
                {logs.map((log, i) => (
                    <div key={i} className="mb-1">{log}</div>
                ))}
            </div>
        </div>
    );
};

export default VapiTest;
