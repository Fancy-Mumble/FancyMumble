import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import {
  getLocalVote,
  getPoll,
  getVotes,
  registerLocalVote,
  type PollPayload,
} from "@core/features/chat/poll/model";
import { Button, ModalSurface, TextField } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

export function PollCreatorSurface({ channelId, onClose }: { channelId: number; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const ownSession = useAppStore((state) => state.ownSession);
  const ownName = useAppStore(
    (state) => state.users.find((user) => user.session === state.ownSession)?.name ?? "You",
  );
  const valid = question.trim() && options.filter((option) => option.trim()).length >= 2;
  const create = async () => {
    if (!valid || ownSession === null) return;
    const poll: PollPayload = {
      type: "poll",
      id: crypto.randomUUID(),
      question: question.trim(),
      options: options.map((option) => option.trim()).filter(Boolean),
      multiple,
      creator: ownSession,
      creatorName: ownName,
      createdAt: new Date().toISOString(),
      channelId,
    };
    await invoke("send_fancy_poll", {
      channelId,
      pollId: poll.id,
      question: poll.question,
      options: poll.options,
      multiple: poll.multiple,
    });
    useAppStore.getState().addPoll(poll, true);
    onClose();
  };
  return (
    <ModalSurface
      title="Create a poll"
      eyebrow="CHANNEL POLL"
      onClose={onClose}
      className={styles.challengeSurface}
    >
      <form
        className={styles.pollCreator}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <TextField
          label="Question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          autoFocus
          maxLength={300}
        />
        {options.map((option, index) => (
          <div className={styles.pollOptionInput} key={index}>
            <TextField
              label={`Option ${index + 1}`}
              value={option}
              onChange={(event) =>
                setOptions((current) =>
                  current.map((value, optionIndex) => (optionIndex === index ? event.target.value : value)),
                )
              }
              maxLength={200}
            />
            {options.length > 2 && (
              <Button
                variant="bare"
                onClick={() =>
                  setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))
                }
              >
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button
          variant="bare"
          disabled={options.length >= 10}
          onClick={() => setOptions((current) => [...current, ""])}
        >
          Add option
        </Button>
        <label className={styles.rememberSecret}>
          <input type="checkbox" checked={multiple} onChange={(event) => setMultiple(event.target.checked)} />
          Allow multiple choices
        </label>
        <footer>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!valid}>
            Create poll
          </Button>
        </footer>
      </form>
    </ModalSurface>
  );
}

export function PollCard({ pollId }: { pollId: string }) {
  const pollVersion = useAppStore((state) => state.polls.size);
  const ownSession = useAppStore((state) => state.ownSession);
  const [selected, setSelected] = useState<number[]>(() => getLocalVote(pollId) ?? []);
  const poll = getPoll(pollId) ?? useAppStore.getState().polls.get(pollId);
  void pollVersion;
  if (!poll) return null;
  const votes = getVotes(pollId);
  const submit = async () => {
    if (ownSession === null || selected.length === 0) return;
    await invoke("send_fancy_poll_vote", { channelId: poll.channelId, pollId, selected });
    registerLocalVote(pollId, selected);
    setSelected([...selected]);
  };
  return (
    <div className={styles.pollCard}>
      <strong>{poll.question}</strong>
      <small>{poll.multiple ? "Choose one or more" : "Choose one"}</small>
      {poll.options.map((option, index) => {
        const count = votes.filter((vote) => vote.selected.includes(index)).length;
        const checked = selected.includes(index);
        return (
          <Button
            variant="bare"
            className={checked ? styles.pollSelected : undefined}
            key={option}
            onClick={() =>
              setSelected((current) =>
                poll.multiple
                  ? current.includes(index)
                    ? current.filter((value) => value !== index)
                    : [...current, index]
                  : [index],
              )
            }
          >
            <i>{checked ? "✓" : ""}</i>
            <span>{option}</span>
            <b>{count}</b>
          </Button>
        );
      })}
      <footer>
        <span>
          {votes.length} vote{votes.length === 1 ? "" : "s"}
        </span>
        <Button variant="primary" disabled={selected.length === 0} onClick={() => void submit()}>
          Vote
        </Button>
      </footer>
    </div>
  );
}
