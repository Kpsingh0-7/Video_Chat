import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

export default function App() {
  const [peer, setPeer] = useState(null);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      socketRef.current = io("https://viseo-chat.onrender.com");

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
        socketRef.current.emit("answer", {
          to: from,
          answer: pc.localDescription,
        });
      });

      socketRef.current.on("answer", async ({ answer }) => {
        await peerConnectionRef.current?.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      });

      socketRef.current.on("icecandidate", async (candidate) => {
        if (candidate && peerConnectionRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
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
        socketRef.current.emit("icecandidate", {
          to: targetId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;

        // Detect video orientation after metadata loads
        const videoEl = remoteVideoRef.current;
        const onLoadedMetadata = () => {
          const isPortrait = videoEl.videoHeight > videoEl.videoWidth;
          setIsPortraitVideo(isPortrait);
        };

        videoEl.addEventListener("loadedmetadata", onLoadedMetadata, {
          once: true,
        });
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
      setMessages((prev) => [
        ...prev,
        { from: socketRef.current.id, message: chatInput },
      ]);
      setChatInput("");
    }
  };

  const touchStartY = useRef(null);

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchStartY.current - touchEndY;

    // Swipe up to trigger "Next"
    if (deltaY > 50 && peer) {
      handleNext();
    }
  };

  return (
    <div
      className="relative bg-black text-white w-screen h-screen overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Remote Video - Fullscreen */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={`absolute top-1/2 left-1/2 max-h-full max-w-full transform -translate-x-1/2 -translate-y-1/2 ${
          isPortraitVideo ? "object-contain" : "object-cover"
        }`}
      />

      {/* Local Video - Corner or Top on mobile */}
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute w-40 h-32 rounded-md z-10 border-2 border-white
                 right-4 bottom-4 sm:bottom-4 sm:top-auto
                 max-sm:top-4 max-sm:bottom-auto"
      />

      {/* Overlay UI */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        {/* Header */}
        <div className="w-full text-center mt-4 pointer-events-auto">
          <h2 className="text-lg font-bold">Stranger Video Chat</h2>
          <div>{status}</div>

          {/* Show only on desktop */}
          {peer && (
            <button
              onClick={handleNext}
              className="mt-2 bg-yellow-500 px-4 py-1 rounded w-40 mx-auto hidden sm:block"
            >
              Next
            </button>
          )}
        </div>

        {/* Message Area */}
        {peer && (
          <div className="absolute bottom-24 left-4 w-80 max-h-48 overflow-y-auto text-sm flex flex-col-reverse space-y-reverse space-y-1 pointer-events-auto">
            {[...messages].reverse().map(({ from, message }, idx) => (
              <div key={idx} className="text-left">
                <b>{from === socketRef.current.id ? "You" : "Stranger"}</b>:{" "}
                {message}
              </div>
            ))}
          </div>
        )}

        {/* Chat Input - Bottom Center */}
        {peer && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg flex gap-2 pointer-events-auto">
            <input
              type="text"
              className="flex-grow p-2 rounded bg-gray-700 text-white"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
              placeholder="Type a message..."
            />
            <button
              className="bg-blue-600 px-4 py-2 rounded whitespace-nowrap"
              onClick={sendMessage}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
