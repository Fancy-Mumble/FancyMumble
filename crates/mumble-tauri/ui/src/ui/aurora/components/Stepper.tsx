import { CheckIcon } from "@ui/icons";
import styles from "./Stepper.module.css";

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  activeStep: number;
  ariaLabel?: string;
  onStepChange?: (index: number) => void;
}

/** Shared progress/navigation primitive for sequential workflows. */
export default function Stepper({ steps, activeStep, ariaLabel = "Progress", onStepChange }: StepperProps) {
  return (
    <ol className={styles.root} aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const state = index < activeStep ? "complete" : index === activeStep ? "active" : "upcoming";
        const content = (
          <>
            <i aria-hidden="true">{state === "complete" ? <CheckIcon /> : index + 1}</i>
            <span>
              <strong>{step.label}</strong>
              {step.description && <small>{step.description}</small>}
            </span>
          </>
        );
        return (
          <li key={step.id} className={styles[state]} aria-current={state === "active" ? "step" : undefined}>
            {onStepChange ? (
              <button type="button" disabled={step.disabled} onClick={() => onStepChange(index)}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
