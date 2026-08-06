import {
  Action,
  ActionPanel,
  Alert,
  Form,
  Icon,
  List,
  LocalStorage,
  Toast,
  showToast,
  confirmAlert,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";

type SshProfile = {
  id: string;
  name: string;
  username: string;
  ipAddress: string;
  port?: number;
  color?: string;
  isFavorite?: boolean;
};

type ProfileFormValues = Pick<SshProfile, "name" | "username" | "ipAddress"> & {
  port: string;
  color: string;
};

const STORAGE_KEY = "ssh-profiles";
const DEFAULT_PROFILE_COLOR = "#5E5CE6";
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

async function readProfiles(): Promise<SshProfile[]> {
  const storedProfiles = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!storedProfiles) return [];

  try {
    return JSON.parse(storedProfiles) as SshProfile[];
  } catch {
    return [];
  }
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
      isValidIpAddress(ipAddress) ? undefined : "Enter a valid IPv4 address",
    );
    setPortError(
      Number.isInteger(port) && port >= 1 && port <= 65535
        ? undefined
        : "Enter a port between 1 and 65535",
    );

    if (
      !name ||
      !username ||
      !isValidIpAddress(ipAddress) ||
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
        title="IP Address"
        placeholder="192.168.1.100"
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
    </Form>
  );
}

export default function Command() {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    readProfiles()
      .then(setProfiles)
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

  const addProfileAction = (
    <Action.Push
      title="Add SSH Profile"
      icon={Icon.Plus}
      target={<ProfileForm onSave={addProfile} />}
    />
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search SSH profiles...">
      {profiles.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Terminal}
          title="No SSH Profiles"
          description="Add a profile to get started."
          actions={<ActionPanel>{addProfileAction}</ActionPanel>}
        />
      ) : null}

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
            accessories={profile.isFavorite ? [{ icon: Icon.Star }] : undefined}
            actions={
              <ActionPanel>
                <Action.Open
                  title="Connect via SSH"
                  icon={Icon.Terminal}
                  target={`ssh://${profile.username}@${profile.ipAddress}:${profile.port ?? 22}`}
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
    </List>
  );
}
