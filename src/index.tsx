import {
  Action,
  ActionPanel,
  Alert,
  Detail,
  Form,
  Icon,
  List,
  LocalStorage,
  Toast,
  showToast,
  confirmAlert,
  useNavigation,
} from "@raycast/api";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { useEffect, useState } from "react";

type SshProfile = {
  id: string;
  name: string;
  username: string;
  ipAddress: string;
  port?: number;
  color?: string;
  notes?: string;
  isFavorite?: boolean;
};

type ProfileFormValues = Pick<SshProfile, "name" | "username" | "ipAddress"> & {
  port: string;
  color: string;
  notes: string;
};

type SshConfigHost = {
  id: string;
  alias: string;
  hostName?: string;
  username?: string;
  port?: number;
  configPath: string;
};

const STORAGE_KEY = "ssh-profiles";
const DEFAULT_PROFILE_COLOR = "#5E5CE6";
const SSH_CONFIG_PATH = path.join(homedir(), ".ssh", "config");
const PROFILE_COLORS = [
  { name: "Blue", value: "#5E5CE6" },
  { name: "Purple", value: "#AF52DE" },
  { name: "Pink", value: "#FF2D55" },
  { name: "Red", value: "#FF3B30" },
  { name: "Orange", value: "#FF9500" },
  { name: "Yellow", value: "#FFCC00" },
  { name: "Green", value: "#34C759" },
  { name: "Grey", value: "#8E8E93" },
];

function isValidIpAddress(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  );
}

function isValidHostname(value: string): boolean {
  if (value.length < 1 || value.length > 253) return false;
  if (/^\d+(?:\.\d+){3}$/.test(value)) return false;

  const hostname = value.endsWith(".") ? value.slice(0, -1) : value;
  return hostname
    .split(".")
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
    );
}

function isValidHost(value: string): boolean {
  return isValidIpAddress(value) || isValidHostname(value);
}

async function readProfiles(): Promise<SshProfile[]> {
  const storedProfiles = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!storedProfiles) return [];

  try {
    return JSON.parse(storedProfiles) as SshProfile[];
  } catch {
    return [];
  }
}

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf("#");
  return hashIndex === -1 ? line : line.slice(0, hashIndex);
}

function hasSshPattern(value: string): boolean {
  return /[*?!]/.test(value) || value.startsWith("!");
}

function isConcreteSshAlias(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && !hasSshPattern(value);
}

function expandSshPath(value: string, configDirectory: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(configDirectory, value);
}

async function expandIncludePattern(pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) return [pattern];

  const segments = pattern.split(path.sep);
  const results: string[] = [];

  async function walk(segmentIndex: number, currentPath: string) {
    if (segmentIndex === segments.length) {
      results.push(currentPath);
      return;
    }

    const segment = segments[segmentIndex];
    if (!segment.includes("*")) {
      await walk(
        segmentIndex + 1,
        currentPath ? path.join(currentPath, segment) : segment,
      );
      return;
    }

    const directory = currentPath || path.sep;
    const matcher = new RegExp(
      `^${segment
        .split("*")
        .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
        .join(".*")}$`,
    );

    try {
      const entries = await readdir(directory, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => matcher.test(entry.name))
          .map((entry) =>
            walk(segmentIndex + 1, path.join(directory, entry.name)),
          ),
      );
    } catch {
      // OpenSSH silently ignores Include globs that do not match.
    }
  }

  await walk(0, pattern.startsWith(path.sep) ? path.sep : "");
  return results;
}

async function parseSshConfigFile(
  configPath: string,
  visitedPaths = new Set<string>(),
): Promise<SshConfigHost[]> {
  const resolvedConfigPath = path.resolve(configPath);
  if (visitedPaths.has(resolvedConfigPath)) return [];
  visitedPaths.add(resolvedConfigPath);

  let contents: string;
  try {
    contents = await readFile(resolvedConfigPath, "utf8");
  } catch {
    return [];
  }

  const hosts: SshConfigHost[] = [];
  let currentAliases: string[] = [];
  let currentOptions: Record<string, string> = {};

  function flushHost() {
    if (currentAliases.length === 0) return;

    const port = currentOptions.port ? Number(currentOptions.port) : undefined;
    for (const alias of currentAliases) {
      if (!isConcreteSshAlias(alias)) continue;

      hosts.push({
        id: `${resolvedConfigPath}:${alias}`,
        alias,
        hostName: currentOptions.hostname,
        username: currentOptions.user,
        port:
          Number.isInteger(port) && port && port >= 1 && port <= 65535
            ? port
            : undefined,
        configPath: resolvedConfigPath,
      });
    }
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const [keyword, ...valueParts] = line.split(/\s+/);
    const normalizedKeyword = keyword.toLowerCase();
    const value = valueParts.join(" ").trim();

    if (normalizedKeyword === "include") {
      const includePatterns = valueParts.map((includePath) =>
        expandSshPath(includePath, path.dirname(resolvedConfigPath)),
      );
      const includePaths = (
        await Promise.all(includePatterns.map(expandIncludePattern))
      ).flat();
      const includedHosts = (
        await Promise.all(
          includePaths.map((includePath) =>
            parseSshConfigFile(includePath, visitedPaths),
          ),
        )
      ).flat();
      hosts.push(...includedHosts);
      continue;
    }

    if (normalizedKeyword === "host") {
      flushHost();
      currentAliases = valueParts.filter(isConcreteSshAlias);
      currentOptions = {};
      continue;
    }

    if (currentAliases.length === 0) continue;
    if (["hostname", "user", "port"].includes(normalizedKeyword)) {
      currentOptions[normalizedKeyword] = value;
    }
  }

  flushHost();
  return hosts;
}

async function readSshConfigHosts(): Promise<SshConfigHost[]> {
  const hosts = await parseSshConfigFile(SSH_CONFIG_PATH);
  const seenAliases = new Set<string>();

  return hosts.filter((host) => {
    const normalizedAlias = host.alias.toLowerCase();
    if (seenAliases.has(normalizedAlias)) return false;
    seenAliases.add(normalizedAlias);
    return true;
  });
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()<>#+\-.!|])/g, "\\$1");
}

function sshUrlForProfile(profile: SshProfile): string {
  return `ssh://${encodeURIComponent(profile.username)}@${profile.ipAddress}:${profile.port ?? 22}`;
}

function sshUrlForConfigHost(host: SshConfigHost): string {
  return `ssh://${host.alias}`;
}

function ProfileForm({
  profile,
  onSave,
}: {
  profile?: SshProfile;
  onSave: (profile: SshProfile) => void;
}) {
  const { pop } = useNavigation();
  const [nameError, setNameError] = useState<string>();
  const [usernameError, setUsernameError] = useState<string>();
  const [ipAddressError, setIpAddressError] = useState<string>();
  const [portError, setPortError] = useState<string>();

  async function handleSubmit(values: ProfileFormValues) {
    const name = values.name.trim();
    const username = values.username.trim();
    const ipAddress = values.ipAddress.trim();
    const portValue = values.port.trim();
    const port = portValue ? Number(portValue) : 22;

    setNameError(name ? undefined : "Enter a friendly name");
    setUsernameError(username ? undefined : "Enter a username");
    setIpAddressError(
      isValidHost(ipAddress)
        ? undefined
        : "Enter a valid hostname or IPv4 address",
    );
    setPortError(
      Number.isInteger(port) && port >= 1 && port <= 65535
        ? undefined
        : "Enter a port between 1 and 65535",
    );

    if (
      !name ||
      !username ||
      !isValidHost(ipAddress) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      return;

    const savedProfile: SshProfile = {
      id: profile?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      username,
      ipAddress,
      port,
      color: values.color,
      notes: values.notes.trim(),
      isFavorite: profile?.isFavorite ?? false,
    };
    const profiles = await readProfiles();
    const updatedProfiles = profile
      ? profiles.map((currentProfile) =>
          currentProfile.id === profile.id ? savedProfile : currentProfile,
        )
      : [...profiles, savedProfile];
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProfiles));
    onSave(savedProfile);
    await showToast({
      style: Toast.Style.Success,
      title: profile ? "SSH profile updated" : "SSH profile saved",
      message: name,
    });
    pop();
  }

  return (
    <Form
      navigationTitle={profile ? "Edit SSH Profile" : "Add SSH Profile"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={profile ? "Update Profile" : "Save Profile"}
            icon={Icon.Checkmark}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Friendly Name"
        placeholder="Home Server"
        defaultValue={profile?.name}
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
      <Form.TextField
        id="username"
        title="Username"
        placeholder="ubuntu"
        defaultValue={profile?.username}
        error={usernameError}
        onChange={() => setUsernameError(undefined)}
      />
      <Form.TextField
        id="ipAddress"
        title="Hostname or IP Address"
        placeholder="server.example.com or 192.168.1.100"
        defaultValue={profile?.ipAddress}
        error={ipAddressError}
        onChange={() => setIpAddressError(undefined)}
      />
      <Form.TextField
        id="port"
        title="Port"
        placeholder="22 (default)"
        defaultValue={profile?.port ? String(profile.port) : ""}
        error={portError}
        onChange={() => setPortError(undefined)}
      />
      <Form.Description text="Port is optional. If left empty, the default SSH port 22 will be used." />
      <Form.Dropdown
        id="color"
        title="Colour"
        defaultValue={profile?.color ?? DEFAULT_PROFILE_COLOR}
      >
        {PROFILE_COLORS.map((color) => (
          <Form.Dropdown.Item
            key={color.value}
            value={color.value}
            title={color.name}
            icon={{ source: Icon.Circle, tintColor: color.value }}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="notes"
        title="Notes"
        placeholder="Optional details about this server"
        defaultValue={profile?.notes ?? ""}
      />
    </Form>
  );
}

function ProfileDetails({
  profile,
  onUpdate,
}: {
  profile: SshProfile;
  onUpdate: (profile: SshProfile) => void;
}) {
  const notes = profile.notes
    ? escapeMarkdown(profile.notes)
    : "_No notes added to this profile._";

  return (
    <Detail
      navigationTitle={profile.name}
      markdown={`# ${escapeMarkdown(profile.name)}\n\n${notes}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Connection"
            text={`${profile.username}@${profile.ipAddress}`}
          />
          <Detail.Metadata.Label title="Username" text={profile.username} />
          <Detail.Metadata.Label
            title="Hostname or IP"
            text={profile.ipAddress}
          />
          <Detail.Metadata.Label
            title="Port"
            text={String(profile.port ?? 22)}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Favourite"
            text={profile.isFavorite ? "Yes" : "No"}
            icon={profile.isFavorite ? Icon.Star : undefined}
          />
          <Detail.Metadata.Label
            title="Colour"
            text={
              PROFILE_COLORS.find((color) => color.value === profile.color)
                ?.name ?? "Blue"
            }
            icon={{
              source: Icon.Circle,
              tintColor: profile.color ?? DEFAULT_PROFILE_COLOR,
            }}
          />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.Open
            title="Connect Via SSH"
            icon={Icon.Terminal}
            target={sshUrlForProfile(profile)}
          />
          <Action.Push
            title="Edit SSH Profile"
            icon={Icon.Pencil}
            target={<ProfileForm profile={profile} onSave={onUpdate} />}
          />
        </ActionPanel>
      }
    />
  );
}

function SshConfigHostDetails({ host }: { host: SshConfigHost }) {
  return (
    <Detail
      navigationTitle={host.alias}
      markdown={`# ${escapeMarkdown(host.alias)}\n\nLoaded from \`${escapeMarkdown(host.configPath)}\`.`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Host Alias" text={host.alias} />
          <Detail.Metadata.Label
            title="HostName"
            text={host.hostName ?? "Not set"}
          />
          <Detail.Metadata.Label
            title="User"
            text={host.username ?? "Not set"}
          />
          <Detail.Metadata.Label
            title="Port"
            text={host.port ? String(host.port) : "Default"}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Config File" text={host.configPath} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.Open
            title="Connect Via SSH"
            icon={Icon.Terminal}
            target={sshUrlForConfigHost(host)}
          />
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([readProfiles(), readSshConfigHosts()])
      .then(([storedProfiles, configHosts]) => {
        setProfiles(storedProfiles);
        setSshConfigHosts(configHosts);
      })
      .finally(() => setIsLoading(false));
  }, []);

  function addProfile(profile: SshProfile) {
    setProfiles((currentProfiles) => [...currentProfiles, profile]);
  }

  function updateProfile(profile: SshProfile) {
    setProfiles((currentProfiles) =>
      currentProfiles.map((currentProfile) =>
        currentProfile.id === profile.id ? profile : currentProfile,
      ),
    );
  }

  async function deleteProfile(profile: SshProfile) {
    const confirmed = await confirmAlert({
      title: `Delete ${profile.name}?`,
      message: "This SSH profile will be permanently removed.",
      primaryAction: {
        title: "Delete Profile",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    const updatedProfiles = profiles.filter(
      (currentProfile) => currentProfile.id !== profile.id,
    );
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProfiles));
    setProfiles(updatedProfiles);
    await showToast({
      style: Toast.Style.Success,
      title: "SSH profile deleted",
      message: profile.name,
    });
  }

  async function toggleFavorite(profile: SshProfile) {
    const updatedProfile = {
      ...profile,
      isFavorite: !profile.isFavorite,
    };
    const updatedProfiles = profiles.map((currentProfile) =>
      currentProfile.id === profile.id ? updatedProfile : currentProfile,
    );
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProfiles));
    setProfiles(updatedProfiles);
    await showToast({
      style: Toast.Style.Success,
      title: updatedProfile.isFavorite
        ? "Added to favourites"
        : "Removed from favourites",
      message: profile.name,
    });
  }

  async function duplicateProfile(profile: SshProfile) {
    const duplicate: SshProfile = {
      ...profile,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `${profile.name} Copy`,
      isFavorite: false,
    };
    const updatedProfiles = [...profiles, duplicate];
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProfiles));
    setProfiles(updatedProfiles);
    await showToast({
      style: Toast.Style.Success,
      title: "SSH profile duplicated",
      message: duplicate.name,
    });
  }

  const addProfileAction = (
    <Action.Push
      title="Add SSH Profile"
      icon={Icon.Plus}
      target={<ProfileForm onSave={addProfile} />}
    />
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search SSH profiles...">
      {profiles.length === 0 && sshConfigHosts.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Terminal}
          title="No SSH Profiles"
          description="Add a profile or create hosts in ~/.ssh/config to get started."
          actions={<ActionPanel>{addProfileAction}</ActionPanel>}
        />
      ) : null}

      {profiles.length > 0 ? (
        <List.Section title="Saved Profiles">
          {[...profiles]
            .sort(
              (firstProfile, secondProfile) =>
                Number(Boolean(secondProfile.isFavorite)) -
                Number(Boolean(firstProfile.isFavorite)),
            )
            .map((profile) => (
              <List.Item
                key={profile.id}
                icon={{
                  source: Icon.Terminal,
                  tintColor: profile.color ?? DEFAULT_PROFILE_COLOR,
                }}
                title={profile.name}
                subtitle={`${profile.username}@${profile.ipAddress}:${profile.port ?? 22}`}
                keywords={profile.notes ? [profile.notes] : undefined}
                accessories={
                  profile.isFavorite ? [{ icon: Icon.Star }] : undefined
                }
                actions={
                  <ActionPanel>
                    <Action.Open
                      title="Connect Via SSH"
                      icon={Icon.Terminal}
                      target={sshUrlForProfile(profile)}
                    />
                    <Action.Push
                      title="View Profile Details"
                      icon={Icon.Eye}
                      target={
                        <ProfileDetails
                          profile={profile}
                          onUpdate={updateProfile}
                        />
                      }
                    />
                    <Action
                      title={
                        profile.isFavorite
                          ? "Remove from Favourites"
                          : "Add to Favourites"
                      }
                      icon={Icon.Star}
                      onAction={() => toggleFavorite(profile)}
                    />
                    <Action.Push
                      title="Edit SSH Profile"
                      icon={Icon.Pencil}
                      target={
                        <ProfileForm profile={profile} onSave={updateProfile} />
                      }
                    />
                    <Action
                      title="Duplicate SSH Profile"
                      icon={Icon.Duplicate}
                      onAction={() => duplicateProfile(profile)}
                    />
                    {addProfileAction}
                    <Action
                      title="Delete SSH Profile"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => deleteProfile(profile)}
                    />
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      ) : null}

      {sshConfigHosts.length > 0 ? (
        <List.Section title="~/.ssh/config">
          {sshConfigHosts.map((host) => (
            <List.Item
              key={host.id}
              icon={Icon.Terminal}
              title={host.alias}
              subtitle={[
                host.username ? `${host.username}@` : "",
                host.hostName ?? host.alias,
                host.port ? `:${host.port}` : "",
              ].join("")}
              keywords={
                [host.hostName, host.username, host.configPath].filter(
                  Boolean,
                ) as string[]
              }
              actions={
                <ActionPanel>
                  <Action.Open
                    title="Connect Via SSH"
                    icon={Icon.Terminal}
                    target={sshUrlForConfigHost(host)}
                  />
                  <Action.Push
                    title="View Host Details"
                    icon={Icon.Eye}
                    target={<SshConfigHostDetails host={host} />}
                  />
                  {addProfileAction}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}
