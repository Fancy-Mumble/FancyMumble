import Avatar from "./Avatar";
import Section from "./Section";
import Specimen from "./Specimen";
import voice from "./VoiceSection.module.css";
import layout from "./designSheetLayout.module.css";
import {
  CloseIcon as X,
  HeadphonesIcon as Headphones,
  MenuIcon as Menu,
  MicIcon as Mic,
  MicOffIcon as MicOff,
  PauseIcon as Pause,
  PlayIcon as Play,
  RadioIcon as Radio,
  VolumeIcon as Volume2,
  WebcamIcon as Video,
} from "@ui/icons";
import { avatars } from "./designSheetData";

/** Section voice of the design sheet. */
export default function VoiceSection() {
  return (
    <Section
      id="voice"
      eyebrow="06 / Voice & media"
      title="Presence you can feel"
      description="Voice rooms, call controls, audio meters, streams, recording, and watch-together surfaces become tactile and legible."
    >
      <div className={layout.specimenGrid}>
        <Specimen title="Active voice room" meta="Call state" wide>
          <div className={voice.voiceRoom}>
            <div className={voice.voiceTop}>
              <div>
                <span className={voice.livePill}>
                  <Radio size={12} /> LIVE
                </span>
                <h3>Design stand-up</h3>
                <p>4 people · Spatial audio on</p>
              </div>
              <div className={voice.voiceTimer}>
                <i /> 24:18
              </div>
            </div>
            <div className={voice.participants}>
              {avatars.map((avatar, index) => (
                <div key={avatar} className={index === 0 ? voice.speaking : ""}>
                  <Avatar
                    label={avatar}
                    online
                    className={
                      index === 0
                        ? `${voice.participantsAvatar} ${voice.participantsSpeakingAvatar}`
                        : voice.participantsAvatar
                    }
                  />
                  <strong>{["Morgan", "Alex", "Sam", "Jo"][index]}</strong>
                  <small>{index === 0 ? "Speaking" : index === 2 ? "Muted" : "Listening"}</small>
                  {index === 2 ? <MicOff /> : <Mic />}
                </div>
              ))}
            </div>
            <div className={voice.callControls}>
              <button type="button">
                <Mic />
                <span>Mute</span>
              </button>
              <button type="button">
                <Headphones />
                <span>Deafen</span>
              </button>
              <button type="button">
                <Video />
                <span>Camera</span>
              </button>
              <button type="button">
                <Menu />
                <span>More</span>
              </button>
              <button type="button" className={voice.hangup}>
                <X />
                <span>Leave</span>
              </button>
            </div>
          </div>
        </Specimen>
        <Specimen title="Audio meter" meta="Input calibration">
          <div className={voice.meter}>
            <span>
              <Mic size={15} /> Studio microphone <b>−12 dB</b>
            </span>
            <div>
              {Array.from({ length: 24 }, (_, index) => (
                <i key={index} className={index < 17 ? voice.meterOn : ""} />
              ))}
            </div>
            <small>Good signal · No clipping detected</small>
          </div>
        </Specimen>
        <Specimen title="Media player" meta="Stream / watch together">
          <div className={voice.player}>
            <div className={voice.playerVisual}>
              <span>
                <Play />
              </span>
              <small>SCREEN SHARE · 1080P</small>
            </div>
            <div className={voice.playerControls}>
              <button type="button">
                <Pause />
              </button>
              <div>
                <i />
              </div>
              <time>12:48 / 34:20</time>
              <button type="button">
                <Volume2 />
              </button>
            </div>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
