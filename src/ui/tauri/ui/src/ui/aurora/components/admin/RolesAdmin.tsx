import { useMemo, useState } from "react";
import type { AclData, AclGroup, RegisteredUser } from "@core/types";
import { Button, Checkbox, SearchField, TextField } from "../primitives";
import styles from "./RolesAdmin.module.css";

const blankRole = (name: string): AclGroup => ({
  name,
  inherited: false,
  inherit: true,
  inheritable: true,
  add: [],
  remove: [],
  inherited_members: [],
  color: null,
  icon: null,
  style_preset: null,
  metadata: {},
});

export default function RolesAdmin({
  acl,
  users,
  onChange,
  onSave,
}: {
  acl: AclData | null;
  users: RegisteredUser[];
  onChange: (acl: AclData) => void;
  onSave: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [excludedId, setExcludedId] = useState("");
  const roles = useMemo(
    () =>
      (acl?.groups ?? []).filter(
        (role) => !query.trim() || role.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [acl, query],
  );
  const selectedIndex = acl?.groups.findIndex((role) => role.name === selectedName) ?? -1;
  const role = selectedIndex >= 0 ? acl!.groups[selectedIndex] : null;
  const patch = (change: Partial<AclGroup>) => {
    if (!acl || selectedIndex < 0) return;
    onChange({
      ...acl,
      groups: acl.groups.map((entry, index) => (index === selectedIndex ? { ...entry, ...change } : entry)),
    });
    if (change.name) setSelectedName(change.name);
  };
  const create = () => {
    const name = newName.trim();
    if (!acl || !name || acl.groups.some((entry) => entry.name === name)) return;
    onChange({ ...acl, groups: [...acl.groups, blankRole(name)] });
    setSelectedName(name);
    setNewName("");
  };
  const remove = () => {
    if (!acl || !role || role.inherited) return;
    onChange({
      ...acl,
      groups: acl.groups.filter((_, index) => index !== selectedIndex),
      acls: acl.acls.filter((entry) => entry.group !== role.name),
    });
    setSelectedName(null);
  };
  const userName = (id: number) => users.find((user) => user.user_id === id)?.name ?? `User #${id}`;
  const addUser = (field: "add" | "remove", raw: string) => {
    const id = Number(raw);
    if (!role || !Number.isInteger(id) || role[field].includes(id)) return;
    patch({ [field]: [...role[field], id] });
    if (field === "add") setMemberId("");
    else setExcludedId("");
  };
  if (!acl) return <div className={styles.loading}>Loading root roles…</div>;
  return (
    <div className={styles.root}>
      <header>
        <div>
          <h3>Roles and groups</h3>
          <p>Manage reusable permission groups and their registered members.</p>
        </div>
        <Button variant="primary" onClick={() => void onSave()}>
          Save roles
        </Button>
      </header>
      <div className={styles.layout}>
        <aside>
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roles"
            aria-label="Search roles"
          />
          <div className={styles.create}>
            <TextField
              label="New role"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="moderator"
            />
            <Button onClick={create} disabled={!newName.trim()}>
              Add
            </Button>
          </div>
          <div className={styles.roles}>
            {roles.map((entry) => (
              <Button
                variant="bare"
                className={selectedName === entry.name ? styles.active : undefined}
                key={entry.name}
                onClick={() => setSelectedName(entry.name)}
              >
                <i style={{ background: entry.color || "#7f8b97" }} />
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {new Set([...entry.add, ...entry.inherited_members]).size} members
                    {entry.inherited ? " · inherited" : ""}
                  </small>
                </span>
              </Button>
            ))}
          </div>
        </aside>
        <main>
          {role ? (
            <>
              <section className={styles.fields}>
                <TextField
                  label="Role name"
                  value={role.name}
                  disabled={role.inherited}
                  onChange={(event) => patch({ name: event.target.value })}
                />
                <label>
                  Color
                  <input
                    type="color"
                    value={role.color || "#7f8b97"}
                    disabled={role.inherited}
                    onChange={(event) => patch({ color: event.target.value })}
                  />
                </label>
                <label>
                  Display style
                  <select
                    value={role.style_preset ?? ""}
                    disabled={role.inherited}
                    onChange={(event) => patch({ style_preset: event.target.value || null })}
                  >
                    <option value="">Default</option>
                    <option value="neon">Neon</option>
                    <option value="gradient">Gradient</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </label>
              </section>
              <section className={styles.checks}>
                <Checkbox
                  label="Inherit members from the parent"
                  checked={role.inherit}
                  disabled={role.inherited}
                  onChange={(event) => patch({ inherit: event.target.checked })}
                />
                <Checkbox
                  label="Allow child channels to inherit this role"
                  checked={role.inheritable}
                  disabled={role.inherited}
                  onChange={(event) => patch({ inheritable: event.target.checked })}
                />
              </section>
              <MemberSection
                title="Direct members"
                values={role.add}
                candidate={memberId}
                users={users}
                disabled={role.inherited}
                resolve={userName}
                onCandidate={setMemberId}
                onAdd={() => addUser("add", memberId)}
                onRemove={(id) => patch({ add: role.add.filter((value) => value !== id) })}
              />
              <MemberSection
                title="Explicitly excluded"
                values={role.remove}
                candidate={excludedId}
                users={users}
                disabled={role.inherited}
                resolve={userName}
                onCandidate={setExcludedId}
                onAdd={() => addUser("remove", excludedId)}
                onRemove={(id) => patch({ remove: role.remove.filter((value) => value !== id) })}
              />
              {role.inherited_members.length > 0 && (
                <section>
                  <h4>Inherited members</h4>
                  <div className={styles.chips}>
                    {role.inherited_members.map((id) => (
                      <span key={id}>{userName(id)}</span>
                    ))}
                  </div>
                </section>
              )}
              {!role.inherited && (
                <footer>
                  <Button variant="danger" onClick={remove}>
                    Delete role
                  </Button>
                </footer>
              )}
            </>
          ) : (
            <div className={styles.blank}>Select a role to edit its display and membership.</div>
          )}
        </main>
      </div>
    </div>
  );
}

function MemberSection({
  title,
  values,
  candidate,
  users,
  disabled,
  resolve,
  onCandidate,
  onAdd,
  onRemove,
}: {
  title: string;
  values: number[];
  candidate: string;
  users: RegisteredUser[];
  disabled: boolean;
  resolve: (id: number) => string;
  onCandidate: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <section>
      <h4>{title}</h4>
      <div className={styles.memberAdd}>
        <label>
          User
          <select value={candidate} disabled={disabled} onChange={(event) => onCandidate(event.target.value)}>
            <option value="">Choose a registered user</option>
            {users
              .filter((user) => !values.includes(user.user_id))
              .map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.name} (#{user.user_id})
                </option>
              ))}
          </select>
        </label>
        <Button disabled={disabled || !candidate} onClick={onAdd}>
          Add member
        </Button>
      </div>
      <div className={styles.chips}>
        {values.map((id) => (
          <span key={id}>
            {resolve(id)}
            {!disabled && (
              <button type="button" aria-label={`Remove ${resolve(id)}`} onClick={() => onRemove(id)}>
                ×
              </button>
            )}
          </span>
        ))}
        {values.length === 0 && <small>No users assigned.</small>}
      </div>
    </section>
  );
}
