import { useState } from "react";
import { addServer } from "@core/serverStorage";
import type { SavedServer } from "@core/types";
import { CheckIcon, SparklesIcon, UsersGroupIcon } from "@ui/icons";
import { Button, TextField } from "../primitives";
import Stepper, { type StepperStep } from "../Stepper";
import styles from "../../AuroraClientSurfaces.module.css";

export interface OnboardingFlowProps {
  onComplete: (server: SavedServer, connectNow: boolean) => void;
}

const STEPS: readonly StepperStep[] = [
  { id: "welcome", label: "Welcome", description: "A quick introduction" },
  { id: "profile", label: "Your profile", description: "Choose how you appear" },
  { id: "server", label: "First server", description: "Save a connection" },
  { id: "ready", label: "Ready", description: "Start talking" },
];

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(64738);
  const [saving, setSaving] = useState(false);
  const canContinue =
    step === 0 || step === 3 || (step === 1 ? username.trim().length > 0 : host.trim().length > 0);

  const finish = async (connectNow: boolean) => {
    if (!host.trim() || !username.trim() || saving) return;
    setSaving(true);
    try {
      const server = await addServer({
        label: label.trim() || host.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        cert_label: null,
        favorite: true,
      });
      onComplete(server, connectNow);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.onboarding}>
      <header>
        <span className={styles.onboardingMark}>
          <SparklesIcon />
        </span>
        <div>
          <small>WELCOME TO FANCY MUMBLE</small>
          <h1>Let’s get you connected.</h1>
          <p>A short setup keeps the client personal without getting in your way.</p>
        </div>
      </header>
      <Stepper steps={STEPS} activeStep={step} ariaLabel="Onboarding progress" />
      <div className={styles.stepContent}>
        {step === 0 && (
          <div className={styles.welcomeStep}>
            <span>
              <UsersGroupIcon />
            </span>
            <h2>Voice chat, made calmer.</h2>
            <p>
              Fancy Mumble brings servers, channels, rich chat, and screen sharing into one focused desktop
              experience.
            </p>
            <div>
              <b>Private by design</b>
              <b>Native voice</b>
              <b>Multiple servers</b>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className={styles.formStep}>
            <small>STEP 2 OF 4</small>
            <h2>How should people see you?</h2>
            <p>You can change this independently for every saved server later.</p>
            <TextField
              label="Display name"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Your display name"
            />
          </div>
        )}
        {step === 2 && (
          <div className={styles.formStep}>
            <small>STEP 3 OF 4</small>
            <h2>Add your first server</h2>
            <p>Enter the connection details provided by your community or team.</p>
            <TextField
              label="Server name"
              hint="Optional"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="My community"
            />
            <TextField
              label="Server address"
              autoFocus
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="voice.example.com"
            />
            <TextField
              label="Port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
            />
          </div>
        )}
        {step === 3 && (
          <div className={styles.readyStep}>
            <span>
              <CheckIcon />
            </span>
            <h2>You’re ready, {username}.</h2>
            <p>
              <strong>{label.trim() || host}</strong> will be saved to your server sidebar. Connect now or
              explore the launcher first.
            </p>
            <div>
              <Button disabled={saving} onClick={() => void finish(false)}>
                Finish setup
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => void finish(true)}>
                {saving ? "Saving…" : "Save & connect"}
              </Button>
            </div>
          </div>
        )}
      </div>
      {step < 3 && (
        <footer>
          <Button disabled={step === 0} onClick={() => setStep((current) => current - 1)}>
            Back
          </Button>
          <span>
            {step + 1} / {STEPS.length}
          </span>
          <Button variant="primary" disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>
            Continue
          </Button>
        </footer>
      )}
    </section>
  );
}
