import { useState } from "react";
import Avatar from "./Avatar";
import timeline from "./MessageTimelineSpecimen.module.css";
import Section from "./Section";
import sharing from "./SharingSpecimen.module.css";
import Specimen from "./Specimen";
import identity from "./designSheetIdentity.module.css";
import layout from "./designSheetLayout.module.css";
import {
  AttachIcon as Paperclip,
  ChevronRightIcon as ChevronRight,
  DownloadIcon as Download,
  EmojiPlusIcon as Smile,
  FileTextIcon as FileText,
  HashIcon as Hash,
  ImageIcon as Image,
  KebabMenuIcon as MoreHorizontal,
  Link2Icon as Link2,
  MicIcon as Mic,
  PlusIcon as Plus,
  SearchIcon as Search,
  SendIcon as Send,
  UploadIcon as CloudUpload,
  UsersGroupIcon as Users,
} from "@ui/icons";

/** Section communication of the design sheet. */
export default function CommunicationSection() {
  const [liked, setLiked] = useState(false);

  return (
    <Section
      id="communication"
      eyebrow="05 / Communication"
      title="Conversation, redesigned"
      description="Messages, reactions, threads, files, previews, polls, mentions, typing, and composition share one rhythm."
    >
      <div className={layout.specimenGrid}>
        <Specimen title="Message timeline" meta="Chat / reactions / reply" wide>
          <div className={timeline.chatCard}>
            <div className={timeline.chatHeader}>
              <span>
                <Hash /> <strong>product-design</strong>
                <small>Build the next chapter</small>
              </span>
              <div>
                <button type="button">
                  <Users size={16} /> 24
                </button>
                <button type="button">
                  <Search size={16} />
                </button>
                <button type="button">
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>
            <div className={timeline.messageList}>
              <div className={timeline.dateDivider}>
                <span>Today</span>
              </div>
              <div className={timeline.message}>
                <Avatar label="AK" online />
                <div>
                  <header>
                    <strong>Alex Kim</strong>
                    <time>10:42</time>
                    <span className={`${identity.roleChip} ${timeline.messageRoleChip}`}>Design</span>
                  </header>
                  <p>
                    I tightened the voice-room states and added the new spatial audio control. The handoff is
                    ready for a look.
                  </p>
                  <div className={timeline.linkCard}>
                    <span>
                      <Link2 />
                    </span>
                    <div>
                      <small>FIGMA · DESIGN SYSTEM</small>
                      <strong>Voice room - final interaction pass</strong>
                      <p>18 frames · Updated 3 minutes ago</p>
                    </div>
                    <ChevronRight />
                  </div>
                  <div className={timeline.reactions}>
                    <button
                      type="button"
                      className={liked ? timeline.reactionsReacted : ""}
                      onClick={() => setLiked((value) => !value)}
                    >
                      ✨ <span>{liked ? 8 : 7}</span>
                    </button>
                    <button type="button">
                      🔥 <span>3</span>
                    </button>
                    <button type="button">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              </div>
              <div className={timeline.message}>
                <Avatar label="MO" />
                <div>
                  <header>
                    <strong>Morgan Oakes</strong>
                    <time>10:45</time>
                  </header>
                  <p>Beautiful. I’ll test the permission states and bring feedback to the review.</p>
                </div>
              </div>
              <div className={timeline.typing}>
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                Sam is typing
              </div>
            </div>
            <div className={timeline.composer}>
              <div
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Message #product-design"
              />
              <div>
                <span>
                  <button type="button">
                    <Plus />
                  </button>
                  <button type="button">
                    <Paperclip />
                  </button>
                  <button type="button">
                    <Image />
                  </button>
                </span>
                <span>
                  <button type="button">
                    <Smile />
                  </button>
                  <button type="button">
                    <Mic />
                  </button>
                  <button type="button" className={timeline.composerSendButton}>
                    <Send />
                  </button>
                </span>
              </div>
            </div>
          </div>
        </Specimen>
        <Specimen title="Attachments" meta="Files / upload">
          <div className={sharing.fileCard}>
            <span>
              <FileText />
            </span>
            <div>
              <strong>Research-notes.pdf</strong>
              <small>4.8 MB · PDF</small>
            </div>
            <button type="button">
              <Download size={16} />
            </button>
          </div>
          <div className={sharing.uploadZone}>
            <CloudUpload />
            <strong>Drop files to share</strong>
            <small>Up to 2 GB per file</small>
          </div>
        </Specimen>
        <Specimen title="Poll" meta="Collaborative choice">
          <div className={sharing.poll}>
            <small>QUICK POLL · 18 VOTES</small>
            <strong>When should we run the design review?</strong>
            {[
              ["Tuesday, 14:00", 72],
              ["Wednesday, 10:00", 28],
            ].map(([label, value]) => (
              <button type="button" key={label as string}>
                <span>
                  {label}
                  <b>{value}%</b>
                </span>
                <i style={{ width: `${value}%` }} />
              </button>
            ))}
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
