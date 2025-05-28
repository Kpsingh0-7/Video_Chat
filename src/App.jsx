import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

export default function App() {
  const [peer, setPeer] = useState(null);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      socketRef.current = io("http://localhost:8080");

      socketRef.current.on("create-offer", async ({ to }) => {
        const pc = createPeerConnection(to);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit("offer", { to, offer: pc.localDescription });
        setPeer(to);
        setStatus("Connected");
      });

      socketRef.current.on("waiting-offer", ({ from }) => {
        setPeer(from);
        setStatus("Connected");
      });

      socketRef.current.on("offer", async ({ from, offer }) => {
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit("answer", { to: from, answer: pc.localDescription });
      });

      socketRef.current.on("answer", async ({ answer }) => {
        await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
      });

      socketRef.current.on("icecandidate", async (candidate) => {
        if (candidate && peerConnectionRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error("ICE error:", err);
          }
        }
      });

      socketRef.current.on("call-ended", () => {
        endCall();
        findNewPartner();
      });

      socketRef.current.on("user-left", () => {
        endCall();
        setStatus("Partner disconnected. Looking for new one...");
        findNewPartner();
      });

      socketRef.current.on("chat-message", ({ from, message }) => {
        setMessages((prev) => [...prev, { from, message }]);
      });

      await startLocalVideo();
      setJoined(true);
      findNewPartner();
    };

    init();

    return () => {
      socketRef.current?.disconnect();
      endCall();
    };
  }, []);

  const startLocalVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing media devices:", err);
    }
  };

  const createPeerConnection = (targetId) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peerConnectionRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit("icecandidate", { to: targetId, candidate: e.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current);
    });

    return pc;
  };

  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setPeer(null);
    setMessages([]);
  };

  const findNewPartner = () => {
    setStatus("Looking for partner...");
    socketRef.current.emit("find-partner");
  };

  const handleNext = () => {
    if (peer) {
      socketRef.current.emit("call-ended", peer);
      endCall();
      findNewPartner();
    }
  };

  const sendMessage = () => {
    if (chatInput.trim() && peer) {
      socketRef.current.emit("chat-message", {
        to: peer,
        message: chatInput,
      });
      setMessages((prev) => [...prev, { from: socketRef.current.id, message: chatInput }]);
      setChatInput("");
    }
  };

  return (
    <div className="p-6 bg-gray-900 text-white min-h-screen flex flex-col items-center">
      <h2 className="text-xl font-bold mb-4">Stranger Video Chat</h2>
      <div className="mb-4">{status}</div>

      <div className="flex mb-4">
        <video ref={localVideoRef} autoPlay muted playsInline className="w-48 h-36 bg-black rounded-md" />
        <video ref={remoteVideoRef} autoPlay playsInline className="w-48 h-36 bg-black rounded-md ml-4" />
      </div>

      {peer && (
        <button onClick={handleNext} className="bg-yellow-500 px-4 py-2 rounded mb-4">
          Next
        </button>
      )}

      {peer && (
        <div className="w-full max-w-md mt-4">
          <div className="border border-gray-700 rounded p-2 mb-2 h-40 overflow-y-auto bg-gray-800">
            {messages.map(({ from, message }, idx) => (
              <div key={idx} className={from === socketRef.current.id ? "text-right" : "text-left"}>
                <b>{from === socketRef.current.id ? "You" : "Stranger"}</b>: {message}
              </div>
            ))}
          </div>
          <input
            type="text"
            className="w-full p-2 rounded bg-gray-700 text-white"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder="Type a message..."
          />
          <button className="mt-2 bg-blue-600 px-4 py-2 rounded" onClick={sendMessage}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
