# Command catalog

Generated from source by `npm run docs:commands`. **78 deterministic commands**, **213 example phrasings** (every example is an automated test in `tests/router.test.ts`), backed by **52 registered tools**.

Deterministic commands work fully offline with no language model. Anything not matched here goes to the configured language model, which can only call the tools listed at the bottom.

## Safety

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Refuses requests to run arbitrary shell commands or scripts. | “run powershell command”<br>“execute this script”<br>“open cmd and run del” | built-in | — | — | — |

## Conversation

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Stop speaking immediately. | “stop talking”<br>“stop”<br>“quiet”<br>“be quiet” | built-in | — | — | — |
| Cancel the current task. | “cancel that”<br>“never mind”<br>“forget it”<br>“go back” | built-in | — | — | — |
| Greetings. | “hey clickyy”<br>“good morning clickyy”<br>“hello” | built-in | — | — | — |
| Check that the assistant is listening. | “are you there”<br>“can you hear me”<br>“you there” | built-in | — | — | — |
| Small talk. | “how are you”<br>“how's it going” | built-in | — | — | — |
| Acknowledges thanks. | “thank you”<br>“thanks”<br>“nice job” | built-in | — | — | — |
| End the conversation and stop follow-up listening. | “that's all”<br>“goodbye”<br>“stop listening” | built-in | — | — | — |
| Describe what Clickyy can do. | “what can you do”<br>“help”<br>“what are your commands” | built-in | — | — | — |
| Who the assistant is (always honest that it is an AI). | “who are you”<br>“are you human”<br>“what's your name” | built-in | — | — | — |
| Repeat the last response. | “can you repeat that”<br>“say that again”<br>“what did you say” | built-in | — | — | — |
| Speak more slowly. | “speak a little slower”<br>“talk slower” | built-in | — | — | — |
| Speak faster. | “speak faster”<br>“talk a bit quicker” | built-in | — | — | — |
| Shorter answers. | “give me the short version”<br>“be more concise” | built-in | — | — | — |
| More detailed answers. | “be more detailed”<br>“explain in more detail” | built-in | — | — | — |
| Start a new conversation. | “let's start a new conversation”<br>“clear the chat” | built-in | — | — | — |
| Resume the previous conversation. | “let's continue where we left off” | built-in | — | — | — |
| Switch personality mode. | “let's switch to work mode”<br>“playful mode”<br>“soothing mode” | built-in | — | — | — |

## Status

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Report the active AI provider and model. | “which model are you using”<br>“check the local ai service” | built-in | — | — | — |
| Report the offline/online routing mode. | “are you in offline mode”<br>“are you online” | built-in | — | — | — |
| Check microphone and speech engine. | “is the microphone working”<br>“check my mic” | built-in | — | — | — |

## Accessibility

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Show keyboard shortcuts. | “show me the available keyboard shortcuts” | built-in | — | — | — |
| Pause voice recognition (mute the microphone). | “pause voice recognition”<br>“mute the microphone” | built-in | — | — | — |
| Reduce or restore animations. | “reduce animations”<br>“turn animations back on” | built-in | — | — | — |
| Toggle high-contrast mode. | “switch to high contrast mode”<br>“turn off high contrast” | built-in | — | — | — |
| Change text size. | “increase the text size”<br>“make the text smaller” | built-in | — | — | — |

## Skills

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Spoken briefing: time, weather, battery and reminders. | “give me my morning briefing”<br>“brief me”<br>“what does my day look like”<br>“daily briefing” | built-in | — | — | — |
| Full system health report in one sentence. | “run a system check”<br>“how's my computer doing”<br>“system report”<br>“run diagnostics” | built-in | — | — | — |
| Look at the screen and answer a question about it (vision model, always asks first). | “what's on my screen”<br>“look at my screen and explain this error”<br>“describe my screen”<br>“what am i looking at” | `screen.capture` | L2 sensitive | screen | always |
| Summarize, explain, translate or proofread what you copied (asks before reading the clipboard). | “summarize what i copied”<br>“explain my clipboard”<br>“proofread what i just copied”<br>“translate my clipboard to spanish” | `clipboard.read` | L2 sensitive | clipboard | always |
| Read what you copied out loud. | “read what i copied”<br>“read my clipboard aloud”<br>“read the selected text aloud” | `clipboard.read` | L2 sensitive | clipboard | always |
| Current weather and today's forecast. | “what's the weather”<br>“weather in london”<br>“do i need an umbrella today”<br>“how's the weather in tokyo”<br>“what's the temperature outside” | `weather.current` | L1 low | web | no |
| Convert units offline. | “convert 5 miles to kilometers”<br>“how many cups in a liter”<br>“100 fahrenheit in celsius”<br>“2 gigabytes in megabytes” | `units.convert` | L1 low | — | no |
| Calculator (offline). | “what's 15 percent of 240”<br>“calculate 12 times 7”<br>“what is the square root of 144”<br>“what is 2 to the power of 10”<br>“what's 1250 divided by 5” | `math.calculate` | L1 low | — | no |

## Memory

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| List what Clickyy has been asked to remember. | “what do you remember about me”<br>“what do you know about me” | `memory.list` | L1 low | — | no |
| Explicitly save a preference or fact. | “remember that I prefer dark roast coffee”<br>“remember my project is called Atlas” | `memory.save` | L1 low | — | no |
| Delete saved memories matching words. | “forget about my coffee preference” | `memory.forget` | L1 low | — | no |

## Productivity

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Cancel a timer, reminder or focus session. | “cancel the timer”<br>“cancel my reminder”<br>“stop the focus session”<br>“cancel all timers” | `reminders.cancel` | L1 low | — | no |
| List reminders and timers. | “what reminders do I have”<br>“how long is left on my timer” | `reminders.list` | L1 low | — | no |
| Start a focus (pomodoro) session. | “start a 25 minute focus session”<br>“start a study session”<br>“begin pomodoro” | `timers.create` | L1 low | — | no |
| Set a countdown timer. | “set a timer for 10 minutes”<br>“5 minute timer”<br>“timer for 90 seconds” | `timers.create` | L1 low | — | no |
| Create a reminder at a time or after a delay. | “remind me in 20 minutes”<br>“remind me to call mom in 1 hour”<br>“create a reminder for tomorrow morning”<br>“remind me at 5 pm to stretch” | `reminders.create` | L1 low | — | no |

## System

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Cancel a pending shutdown or restart. | “cancel shutdown”<br>“abort the restart” | `power.abort` | L1 low | — | no |
| Shut down, restart or sign out (always confirmed). | “shut down my computer”<br>“restart the pc”<br>“sign me out” | `power.action` | L3 destructive | power | always |
| Lock the workstation. | “lock my pc”<br>“lock the screen” | `system.lock` | L1 low | system | no |
| Current time and date. | “what time is it”<br>“what's the date”<br>“what day is it” | `system.time` | L1 low | — | no |
| Battery level and charging. | “how much battery do I have”<br>“is my laptop charging” | `system.battery` | L1 low | system | no |
| Processes using the most memory. | “what's using my memory”<br>“show running processes” | `system.processes` | L1 low | system | no |
| CPU and RAM usage. | “how much ram is being used”<br>“show cpu usage” | `system.resources` | L1 low | system | no |
| Free disk space. | “how much disk space is available”<br>“how much storage do I have left” | `system.disk` | L1 low | system | no |
| Internet and Wi-Fi status. | “is the internet connected”<br>“am i online”<br>“what wifi am i on” | `system.network` | L1 low | system | no |
| System uptime. | “what's my system uptime”<br>“how long has my pc been on” | `system.uptime` | L1 low | system | no |
| Active audio devices. | “which audio device is active”<br>“what's my default microphone” | `system.audio_devices` | L1 low | system | no |
| Open Task Manager. | “open task manager” | `system.task_manager` | L1 low | system | no |
| Open a Windows Settings page. | “open windows settings”<br>“open bluetooth settings”<br>“open sound settings” | `system.open_settings` | L1 low | system | no |
| Open a standard folder in File Explorer. | “show my downloads”<br>“open my documents”<br>“open my project folder”<br>“open the last approved workspace” | `system.open_folder` | L1 low | system | no |

## Audio

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Set the volume to a level. | “set volume to 30 percent”<br>“lower the volume to 30 percent”<br>“volume 50”<br>“put the volume at 20” | `audio.set_volume` | L1 low | media | no |
| Raise or lower the volume. | “turn the volume down a little”<br>“louder”<br>“volume up”<br>“turn it up by 20” | `audio.set_volume` | L1 low | media | no |
| Unmute the speakers. | “unmute”<br>“unmute my computer”<br>“turn the sound back on” | `audio.mute` | L1 low | media | no |
| Mute the speakers. | “mute my computer”<br>“mute”<br>“turn the sound off” | `audio.mute` | L1 low | media | no |
| Restore the previous volume. | “restore the previous volume”<br>“put the volume back” | `audio.restore_volume` | L1 low | media | no |
| Read the current volume. | “what's the volume”<br>“how loud is it”<br>“is my sound muted” | `audio.get_volume` | L1 low | media | no |

## Media

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| What's currently playing. | “what's playing”<br>“what song is this” | `media.now_playing` | L1 low | media | no |
| Pause playback. | “pause the music”<br>“pause” | `media.control` | L1 low | media | no |
| Resume playback. | “resume playback”<br>“play music”<br>“continue the song” | `media.control` | L1 low | media | no |
| Next track. | “skip this track”<br>“next song” | `media.control` | L1 low | media | no |
| Previous track. | “play the previous track”<br>“previous song” | `media.control` | L1 low | media | no |
| Stop playback. | “stop the music”<br>“stop playback” | `media.control` | L1 low | media | no |
| Search Spotify for music. | “play my focus playlist”<br>“play lofi on spotify”<br>“find taylor swift on spotify” | `media.spotify_search` | L1 low | media | no |

## Web

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Open a website. | “open youtube.com”<br>“go to github.com”<br>“open the official website of python.org” | `web.open` | L1 low | web | no |
| Search the web in your browser. | “search for the latest node documentation”<br>“look up electron security checklist”<br>“google best pizza near me” | `web.search` | L1 low | web | no |

## Windows

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| List open apps. | “show me my open applications”<br>“what apps are open” | `windows.list` | L1 low | windows | no |
| Minimize everything / restore everything. | “minimize everything”<br>“show the desktop”<br>“restore all windows” | `windows.show_desktop` | L1 low | windows | no |
| Switch to the previous window. | “switch to the previous window”<br>“go back to the last window” | `windows.previous` | L1 low | windows | no |
| Minimize, maximize, restore or snap windows. | “minimize the current window”<br>“maximize this window”<br>“put the browser on the left”<br>“move the editor to the right” | `windows.arrange` | L1 low | windows | no |
| Close a window (confirmed; the app may ask to save). | “close this window”<br>“close it”<br>“close notepad” | `windows.close` | L2 sensitive | windows | always |
| Bring an app window to the front. | “switch to the browser”<br>“bring my code editor to the front”<br>“go to spotify” | `windows.focus` | L1 low | windows | no |

## Apps

| Command | Example phrasings | Tool | Risk | Permission | Confirmation |
|---|---|---|---|---|---|
| Open an approved application or alias. | “open chrome”<br>“launch spotify”<br>“open vs code”<br>“start notepad”<br>“open it again” | `apps.open` | L1 low | apps | no |

## Tool registry

Every tool has a typed zod input schema, permission, confirmation policy, timeout and audit logging. The model sees tool names with `__` instead of `.`.

| Tool | Description | Risk | Permission | Timeout | Works offline |
|---|---|---|---|---|---|
| `system.time` | Get the current local date and time. | L1 low | — | 1s | yes |
| `system.battery` | Get battery percentage and charging state. | L1 low | system | 5s | yes |
| `system.resources` | Measure current CPU and RAM usage. | L1 low | system | 3s | yes |
| `system.disk` | Report free disk space on a drive. | L1 low | system | 3s | yes |
| `system.network` | Report internet connectivity and Wi-Fi status. | L1 low | system | 6s | yes |
| `system.uptime` | How long the computer has been running. | L1 low | system | 1s | yes |
| `system.audio_devices` | Name the default speaker and microphone. | L1 low | system | 5s | yes |
| `system.processes` | List the processes using the most memory (read-only). | L1 low | system | 8s | yes |
| `system.open_settings` | Open a Windows Settings page. Pages: home, display, sound, bluetooth, wifi, network, battery, power, notifications, apps, startup, privacy, microphone, updates, accessibility, personalization, storage, mouse, keyboard, date, language, defaultapps, focus. | L1 low | system | 5s | yes |
| `system.task_manager` | Open Windows Task Manager. | L1 low | system | 5s | yes |
| `system.open_folder` | Open a standard user folder in File Explorer: home, desktop, documents, downloads, pictures, music, videos, workspace. | L1 low | system | 5s | yes |
| `system.lock` | Lock the Windows session (documented LockWorkStation API). | L1 low | system | 5s | yes |
| `power.action` | Shut down, restart, or sign out of Windows. Shutdown and restart use a 30 second countdown that can be aborted. | L3 destructive | power | 8s | yes |
| `power.abort` | Abort a pending shutdown or restart. | L1 low | — | 5s | yes |
| `audio.get_volume` | Read the current master volume and mute state. | L1 low | media | 4s | yes |
| `audio.set_volume` | Set the master volume to an absolute percentage (0-100), or change it by a relative amount. | L1 low | media | 4s | yes |
| `audio.mute` | Mute or unmute the speakers. | L1 low | media | 4s | yes |
| `audio.restore_volume` | Restore the volume level from before the last change. | L1 low | media | 4s | yes |
| `media.control` | Control the active media session: toggle, play, pause, next, previous, stop. | L1 low | media | 6s | yes |
| `media.spotify_search` | Open Spotify search results for a song, artist or playlist (uses the spotify: URI scheme; does not press play). | L1 low | media | 6s | no |
| `media.now_playing` | Report the current media title and artist from the Windows media session. | L1 low | media | 6s | yes |
| `apps.open` | Open an application from the approved app registry by name or alias. | L1 low | apps | 12s | yes |
| `windows.list` | List the open application windows. | L1 low | windows | 5s | yes |
| `windows.focus` | Bring a window to the front. Query can be an app name, a title fragment, or a category like browser, editor, terminal, music. | L1 low | windows | 6s | yes |
| `windows.arrange` | Minimize, maximize, restore, or snap a window left/right. Omit query for the current window. | L1 low | windows | 6s | yes |
| `windows.close` | Ask a window to close (the app may prompt to save). Omit query for the current window. | L2 sensitive | windows | 60s | yes |
| `windows.previous` | Switch to the window that was in front before the current one. | L1 low | windows | 6s | yes |
| `windows.show_desktop` | Minimize all windows, or undo it. | L1 low | windows | 5s | yes |
| `web.open` | Open an http(s) website in the default browser. | L1 low | web | 5s | no |
| `web.search` | Open a web search for a query in the default browser using the configured search engine. | L1 low | web | 5s | no |
| `files.list` | List files in an approved folder (non-recursive). | L1 low | files | 8s | yes |
| `files.search` | Search file names (case-insensitive substring) inside approved folders only. | L1 low | files | 15s | yes |
| `files.read_text` | Read a text file inside an approved folder (max 200 KB). | L1 low | files | 8s | yes |
| `files.open` | Open an approved file or folder with its default Windows app. | L1 low | files | 8s | yes |
| `files.create` | Create a new text file in the configured workspace folder. Never overwrites. | L2 sensitive | files | 8s | yes |
| `files.move` | Move or rename a file within approved folders. Never overwrites an existing file. | L2 sensitive | files | 10s | yes |
| `files.trash` | Move a file in an approved folder to the Recycle Bin. | L3 destructive | files | 10s | yes |
| `reminders.create` | Create a local reminder after a delay in seconds, or at an ISO-8601 local time. | L1 low | — | 3s | yes |
| `timers.create` | Start a countdown timer, or a focus session when focus is true. | L1 low | — | 3s | yes |
| `reminders.list` | List pending reminders, timers and focus sessions. | L1 low | — | 2s | yes |
| `reminders.cancel` | Cancel the most recent pending reminder/timer, or one by id, or all of them. | L1 low | — | 2s | yes |
| `memory.save` | Save something the user explicitly asked you to remember. Never store passwords or other secrets. | L1 low | — | 2s | yes |
| `memory.forget` | Delete saved memories that contain the given words. | L1 low | — | 2s | yes |
| `memory.list` | List explicitly saved memories. | L1 low | — | 2s | yes |
| `clipboard.copy` | Put text on the clipboard. | L1 low | clipboard | 4s | yes |
| `clipboard.read` | Read the current clipboard text. Requires confirmation. | L2 sensitive | clipboard | 30s | yes |
| `keyboard.shortcut` | Press an allowlisted shortcut in the foreground app: copy, paste, cut, undo, redo, select_all, save, find, new_tab, close_tab, new_window, next_tab, previous_tab, switch_window, enter, escape, tab, refresh. | L2 sensitive | automation | 30s | yes |
| `keyboard.type` | Type user-approved text into the focused field of the foreground window. Always confirmed; refuses credential-like text. | L2 sensitive | automation | 60s | yes |
| `math.calculate` | Evaluate an arithmetic expression offline (+ - * / ^ %, parentheses, sqrt, sin/cos/tan in degrees, log, ln, pi, e). | L1 low | — | 1s | yes |
| `units.convert` | Convert between units of length, mass, volume, speed, data size, time, area and temperature, offline. | L1 low | — | 1s | yes |
| `weather.current` | Current weather and today's forecast for a place (or the location set in Settings), via Open-Meteo. | L1 low | web | 12s | no |
| `screen.capture` | Capture one screenshot of the primary display so a vision-capable model can answer a question about it. Always asks first; the image is not stored. | L2 sensitive | screen | 60s | yes |
