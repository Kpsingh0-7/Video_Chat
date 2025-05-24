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
  const pendingCandidatesRef = useRef([]);

  useEffect(() => {
    if (socketRef.current) return;

    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");
      setStatus("Looking for a partner...");
    };

    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log("WS message:", data);

      if (data.type === "paired") {
        setStatus("Connected to a stranger.");
        setMessages([]);
        await startMediaAndConnection(true);
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
      console.log("WebSocket disconnected");
      setStatus("Disconnected from server.");
    };

    socket.onerror = (e) => {
      console.error("WebSocket error", e);
    };

    return () => {
      socket.close();
      socketRef.current = null;
      cleanupConnection();
    };
  }, []);

  const createPeerConnection = (stream) => {
    const pc = new RTCPeerConnection();

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      console.log("Received remote stream");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("Sending ICE candidate");
        socketRef.current.send(JSON.stringify({ type: "signal", signal: { candidate: e.candidate } }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        cleanupConnection();
        setStatus("Stranger disconnected. Looking for a new one...");
        socketRef.current.send(JSON.stringify({ type: "next" }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
    };

    return pc;
  };

  const startMediaAndConnection = async (createOffer) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = createPeerConnection(stream);
      peerRef.current = pc;

      if (createOffer) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.send(JSON.stringify({ type: "signal", signal: { offer } }));
      }
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setStatus("Could not access camera/microphone.");
    }
  };

  const handleSignal = async (signal) => {
    let pc = peerRef.current;

    if (signal.offer) {
      console.log("Received offer");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        pc = createPeerConnection(stream);
        peerRef.current = pc;

        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.send(JSON.stringify({ type: "signal", signal: { answer } }));

        for (const candidate of pendingCandidatesRef.current) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error("Error adding queued ICE candidate:", err);
          }
        }
        pendingCandidatesRef.current = [];
      } catch (err) {
        console.error("Error handling offer signal:", err);
      }
    } else if (signal.answer) {
      console.log("Received answer");
      if (pc && pc.signalingState === "have-local-offer") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
        } catch (err) {
          console.error("Error setting remote answer:", err);
        }

        for (const candidate of pendingCandidatesRef.current) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error("Error adding queued ICE candidate:", err);
          }
        }
        pendingCandidatesRef.current = [];
      } else {
        console.warn("Ignoring remote answer, signalingState:", pc?.signalingState);
      }
    } else if (signal.candidate) {
      console.log("Received ICE candidate");
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (err) {
          console.error("Error adding ICE candidate:", err);
        }
      } else {
        console.log("Queuing ICE candidate until remote description set");
        pendingCandidatesRef.current.push(signal.candidate);
      }
    }
  };

  const sendMessage = () => {
    if (input.trim()) {
      setMessages((msgs) => [...msgs, { text: input, from: "me" }]);
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
    pendingCandidatesRef.current = [];
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-2">Omegle Clone</h1>
      <p className="mb-4">{status}</p>

      <div className="flex gap-4 mb-4">
        <video ref={localVideoRef} autoPlay muted playsInline className="w-1/2 rounded shadow" />
        <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 rounded shadow" />
      </div>

      <div className="w-full max-w-md bg-gray-800 p-4 rounded shadow mb-4 h-64 overflow-y-auto">
        {messages.map((msg, idx) => (
          <p
            key={idx}
            className={msg.from === "me" ? "text-right text-green-400" : "text-left text-blue-300"}
          >
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
        <button onClick={sendMessage} className="bg-blue-600 px-4 rounded hover:bg-blue-700">
          Send
        </button>
        <button onClick={handleNext} className="bg-red-600 px-4 rounded hover:bg-red-700">
          Next
        </button>
      </div>
    </div>
  );
}

