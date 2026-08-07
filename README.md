# SSH Profile Launcher for Raycast

A Raycast extension for saving SSH connection profiles and quickly opening them in your system's configured terminal.

## Features

- Save a friendly name, username, hostname or IPv4 address, and port for each SSH profile
- Assign a colour to each profile for quick visual identification
- Add searchable notes about a server's purpose or environment
- View notes and connection metadata on a dedicated profile details page
- Duplicate an existing profile to quickly create a similar connection
- Search saved profiles from Raycast
- Automatically list concrete `Host` aliases from `~/.ssh/config`
- Mark profiles as favourites and keep them at the top of the list
- Press <kbd>Enter</kbd> to connect to the selected profile
- Edit existing profiles
- Delete profiles with a confirmation prompt
- Store profiles locally using Raycast's local storage

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- Node.js and npm
- An existing SSH setup, such as a password or SSH key accepted by the remote server

You must configure and test the SSH connection before adding it to this extension. The extension launches existing SSH connections; it does not configure authentication, passwords, keys, or the remote server for you.

Confirm that you can connect successfully from Terminal first:

```bash
ssh username@ip-address
```

Once that command works, add the same username and IP address to the Raycast extension.

The extension opens an `ssh://username@ip-address` URL. macOS normally handles this with Terminal, although the exact application depends on your system's configured SSH URL handler.

## SSH config support

The extension also reads `~/.ssh/config` and lists concrete `Host` aliases in a separate `~/.ssh/config` section. Selecting one opens `ssh://alias`, so your existing OpenSSH settings such as `HostName`, `User`, `Port`, and identity files continue to be resolved by SSH.

For example:

```ssh-config
Host staging
  HostName staging.example.com
  User deploy
  Port 2222
```

The `staging` alias will appear in Raycast without creating a saved profile. `Include` files and simple include globs are supported. Wildcard or negated host patterns such as `Host *.example.com` and `Host !bastion *` are skipped because they are not concrete launch targets.

## Development setup

Clone the repository and install its dependencies:

```bash
npm install
```

Start the extension in Raycast development mode:

```bash
npm run dev
```

Raycast will register the development extension. Open Raycast and search for **SSH Profiles**.

## Usage

1. Open the **SSH Profiles** command in Raycast.
2. Select **Add SSH Profile**.
3. Enter a friendly name, SSH username, and either a hostname, IPv4 address, or SSH config host alias. The port is optional; leave it empty to use the default SSH port, `22`.
4. Save the profile.
5. Select the profile and press <kbd>Enter</kbd> to connect.

Use the profile's action panel to edit, add, or delete profiles.

## Scripts

```bash
npm run dev    # Run the extension in development mode
npm run build  # Build the extension
npm run lint   # Run Raycast, ESLint, and Prettier checks
```

## Publishing

Before running the publishing checks or submitting the extension to the Raycast Store, set the `author` field in `package.json` to your registered Raycast username.

## Data storage

Profiles are stored on the local device through Raycast's `LocalStorage` API. They are not uploaded by this extension. Passwords and private keys are not collected or stored.

## License

MIT
