import React, { useState, useEffect, useRef } from "react";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("Connecting...");
  const [input, setInput] = useState("");
  const socketRef = useRef(null);
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const localStreamRef = useRef();
  const peerRef = useRef(null);

  useEffect(() => {
    const socket = new WebSocket("https://viseo-chat.onrender.com/");
    socketRef.current = socket;

    socket.onopen = () => setStatus("Looking for a partner...");

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "paired") {
        setStatus("Connected to a stranger.");
        setMessages([]);
        startMediaAndConnection(true);
      } else if (data.type === "chat") {
        setMessages((msgs) => [...msgs, { text: data.message, from: "stranger" }]);
      } else if (data.type === "partner-disconnected") {
        cleanupConnection();
        setStatus("Stranger disconnected. Looking for a new one...");
      } else if (data.type === "signal") {
        await handleSignal(data.signal);
      }
    };

    socket.onclose = () => {
      setStatus("Disconnected from server.");
    };

    return () => {
      socket.close();
    };
  }, []);

  const startMediaAndConnection = async (createOffer) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    localVideoRef.current.srcObject = stream;

    const pc = new RTCPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      remoteVideoRef.current.srcObject = event.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.send(JSON.stringify({ type: "signal", signal: { candidate: e.candidate } }));
      }
    };

    peerRef.current = pc;

    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.send(JSON.stringify({ type: "signal", signal: { offer } }));
    }
  };

  const handleSignal = async (signal) => {
  const pc = peerRef.current;

  if (signal.offer) {
    await startMediaAndConnection(false); // ensures peerRef is set
    await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current.send(JSON.stringify({ type: "signal", signal: { answer } }));

    // Add any ICE candidates that were received before the offer
    pendingCandidatesRef.current.forEach(async (candidate) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Delayed ICE error:", err);
      }
    });
    pendingCandidatesRef.current = [];

  } else if (signal.answer) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));

    // Add queued candidates now
    pendingCandidatesRef.current.forEach(async (candidate) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Delayed ICE error:", err);
      }
    });
    pendingCandidatesRef.current = [];

  } else if (signal.candidate) {
    if (pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (err) {
        console.error("ICE error:", err);
      }
    } else {
      pendingCandidatesRef.current.push(signal.candidate); // queue it
    }
  }
};


  const sendMessage = () => {
    if (input.trim()) {
      setMessages([...messages, { text: input, from: "me" }]);
      socketRef.current.send(JSON.stringify({ type: "chat", message: input }));
      setInput("");
    }
  };

  const handleNext = () => {
    cleanupConnection();
    setStatus("Looking for a new partner...");
    setMessages([]);
    socketRef.current.send(JSON.stringify({ type: "next" }));
  };

  const cleanupConnection = () => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-2">Omegle Clone</h1>
      <p className="mb-4">{status}</p>

      <div className="flex gap-4 mb-4">
        <video ref={localVideoRef} autoPlay muted className="w-1/2 rounded shadow" />
        <video ref={remoteVideoRef} autoPlay className="w-1/2 rounded shadow" />
      </div>

      <div className="w-full max-w-md bg-gray-800 p-4 rounded shadow mb-4 h-64 overflow-y-auto">
        {messages.map((msg, idx) => (
          <p key={idx} className={msg.from === "me" ? "text-right text-green-400" : "text-left text-blue-300"}>
            {msg.from === "me" ? "You: " : "Stranger: "} {msg.text}
          </p>
        ))}
      </div>

      <div className="flex gap-2 w-full max-w-md">
        <input
          className="flex-1 p-2 rounded bg-gray-700 border border-gray-600"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message"
        />
        <button onClick={sendMessage} className="bg-blue-600 px-4 rounded hover:bg-blue-700">Send</button>
        <button onClick={handleNext} className="bg-red-600 px-4 rounded hover:bg-red-700">Next</button>
      </div>
    </div>
  );
}
