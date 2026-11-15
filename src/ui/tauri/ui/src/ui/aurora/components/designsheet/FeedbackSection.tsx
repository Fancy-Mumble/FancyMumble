import feedback from "./FeedbackSection.module.css";
import Section from "./Section";
import Specimen from "./Specimen";
import layout from "./designSheetLayout.module.css";
import {
  CheckIcon as Check,
  CloseIcon as X,
  InfoIcon as Info,
  UploadIcon as CloudUpload,
  WarningIcon as AlertTriangle,
} from "@ui/icons";

/** Section feedback of the design sheet. */
export default function FeedbackSection() {
  return (
    <Section
      id="feedback"
      eyebrow="04 / Feedback"
      title="Every state speaks"
      description="Banners, progress, loading, notification, and validation patterns keep system feedback consistent and calm."
    >
      <div className={layout.specimenGrid}>
        <Specimen title="Banners" meta="Info / warning / success" wide>
          <div className={feedback.bannerStack}>
            <div className={feedback.infoBanner}>
              <Info size={18} />
              <span>
                <strong>A new version is ready</strong>
                <small>Restart Fancy Mumble to finish updating.</small>
              </span>
              <button type="button">Restart</button>
              <X size={15} />
            </div>
            <div className={feedback.warningBanner}>
              <AlertTriangle size={18} />
              <span>
                <strong>Your encryption key changed</strong>
                <small>Verify this device before sharing sensitive files.</small>
              </span>
              <button type="button">Review</button>
            </div>
            <div className={feedback.successBanner}>
              <Check size={18} />
              <span>
                <strong>Connected securely</strong>
                <small>All messages are end-to-end encrypted.</small>
              </span>
            </div>
          </div>
        </Specimen>
        <Specimen title="Progress & loading" meta="Determinate / skeleton">
          <div className={feedback.progressDemo}>
            <span>
              <CloudUpload size={16} /> Uploading project-notes.pdf <b>68%</b>
            </span>
            <div>
              <i />
            </div>
          </div>
          <div className={feedback.skeleton}>
            <i />
            <span>
              <b />
              <b />
            </span>
          </div>
        </Specimen>
        <Specimen title="Toast notification" meta="Transient feedback">
          <div className={feedback.toast}>
            <span className={feedback.toastIcon}>
              <Check size={16} />
            </span>
            <span>
              <strong>Link copied</strong>
              <small>Ready to share with your team.</small>
            </span>
            <button type="button">
              <X size={14} />
            </button>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
