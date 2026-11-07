/**
 * Windows destinations Clickyy can open by name. All are fixed, documented targets:
 * ms-settings: pages, built-in System32 tools and shell: folders. Nothing user-supplied
 * is ever passed to a program; the user only picks an id from these tables.
 */

/** id | spoken names | ms-settings URI */
const SETTINGS_RAW = `
home|windows settings,settings,system settings|ms-settings:
system|system|ms-settings:system
display|display,screen,brightness,resolution,screen resolution,scale,scaling|ms-settings:display
nightlight|night light,blue light,eye comfort|ms-settings:nightlight
hdr|hdr,hdr video|ms-settings:display-advancedgraphics
graphics|graphics,gpu preference,graphics performance|ms-settings:display-advancedgraphics
sound|sound,audio,speakers,volume mixer settings|ms-settings:sound
sounddevices|sound devices,audio devices,all sound devices|ms-settings:sound-devices
volumemixer|volume mixer,app volume|ms-settings:apps-volume
notifications|notifications,notification|ms-settings:notifications
focus|focus,focus assist,do not disturb,dnd,quiet hours|ms-settings:quiethours
power|power,sleep,power and sleep,screen timeout|ms-settings:powersleep
battery|battery,battery saver,energy saver|ms-settings:batterysaver
batteryusage|battery usage,battery use by app|ms-settings:batterysaver-usagedetails
storage|storage,disk space settings,storage sense|ms-settings:storagesense
cleanup|cleanup recommendations,storage cleanup|ms-settings:storagerecommendations
nearbysharing|nearby sharing,nearby share|ms-settings:crossdevice
multitasking|multitasking,snap windows,snap layouts|ms-settings:multitasking
activation|activation,windows activation,product key|ms-settings:activation
troubleshoot|troubleshoot,troubleshooters,troubleshooting|ms-settings:troubleshoot
recovery|recovery,reset this pc,reset pc|ms-settings:recovery
projecting|projecting to this pc,projection|ms-settings:project
remotedesktop|remote desktop|ms-settings:remotedesktop
clipboard|clipboard,clipboard history|ms-settings:clipboard
about|about,about this pc,pc name,device specifications,specs,system info settings|ms-settings:about
bluetooth|bluetooth,bluetooth devices|ms-settings:bluetooth
devices|devices,connected devices|ms-settings:connecteddevices
printers|printers,printers and scanners,printer,scanner|ms-settings:printers
phonelink|phone link,mobile devices,your phone|ms-settings:mobile-devices
cameras|cameras,camera settings,webcam|ms-settings:camera
mouse|mouse,mouse speed,cursor speed|ms-settings:mousetouchpad
touchpad|touchpad,trackpad,touch pad|ms-settings:devices-touchpad
pen|pen,pen and windows ink,windows ink|ms-settings:pen
autoplay|autoplay,auto play|ms-settings:autoplay
usb|usb|ms-settings:usb
network|network,internet,network and internet,network status|ms-settings:network-status
wifi|wifi,wi fi,wireless,wifi settings|ms-settings:network-wifi
ethernet|ethernet,wired network,lan|ms-settings:network-ethernet
vpn|vpn|ms-settings:network-vpn
mobilehotspot|mobile hotspot,hotspot,tethering|ms-settings:network-mobilehotspot
airplane|airplane mode,flight mode|ms-settings:network-airplanemode
proxy|proxy|ms-settings:network-proxy
dialup|dial up|ms-settings:network-dialup
advancednetwork|advanced network settings,network adapters|ms-settings:network-advancedsettings
datausage|data usage|ms-settings:datausage
personalization|personalization,personalize,customize|ms-settings:personalization
background|background,wallpaper,desktop background|ms-settings:personalization-background
colors|colors,accent color,dark mode,light mode,dark theme|ms-settings:personalization-colors
themes|themes,theme|ms-settings:themes
lockscreen|lock screen,lockscreen|ms-settings:lockscreen
textinput|text input,touch keyboard settings|ms-settings:personalization-textinput
start|start menu,start settings|ms-settings:personalization-start
startfolders|start folders|ms-settings:personalization-start-places
taskbar|taskbar,task bar|ms-settings:taskbar
fonts|fonts|ms-settings:fonts
deviceusage|device usage|ms-settings:deviceusage
apps|apps,app,apps and features,installed apps,programs,uninstall programs,uninstall apps,add or remove programs|ms-settings:appsfeatures
defaultapps|default apps,default browser,default programs|ms-settings:defaultapps
optionalfeatures|optional features|ms-settings:optionalfeatures
offlinemaps|offline maps,maps settings|ms-settings:maps
appsforwebsites|apps for websites|ms-settings:appsforwebsites
videoplayback|video playback|ms-settings:videoplayback
startup|startup,startup apps,startup programs,apps on startup|ms-settings:startupapps
advancedapps|advanced app settings,app execution aliases|ms-settings:advanced-apps
accounts|accounts,account,your account,your info|ms-settings:yourinfo
emailaccounts|email accounts,email and accounts|ms-settings:emailandaccounts
signin|sign in options,sign-in options,password,pin,windows hello,fingerprint,face recognition|ms-settings:signinoptions
family|family,family safety,other users|ms-settings:family-group
otherusers|other users,add user|ms-settings:otherusers
backup|backup,windows backup|ms-settings:backup
workaccess|access work or school,work or school|ms-settings:workplace
date|date,time,date and time,clock settings,time zone|ms-settings:dateandtime
language|language,region,language and region,display language|ms-settings:regionlanguage
typing|typing,autocorrect,spell check,text suggestions|ms-settings:typing
speech|speech,speech settings,voice typing|ms-settings:speech
keyboard|keyboard,keyboard layout,input settings|ms-settings:keyboard
gaming|gaming,game settings|ms-settings:gaming-gamebar
gamebar|game bar,xbox game bar|ms-settings:gaming-gamebar
captures|captures,game captures,screen recording settings|ms-settings:gaming-gamedvr
gamemode|game mode|ms-settings:gaming-gamemode
accessibility|accessibility,ease of access|ms-settings:easeofaccess
textsize|text size,font size,bigger text|ms-settings:easeofaccess-display
visualeffects|visual effects,animation effects,transparency|ms-settings:easeofaccess-visualeffects
mousepointer|mouse pointer,pointer size,cursor size|ms-settings:easeofaccess-mousepointer
textcursor|text cursor|ms-settings:easeofaccess-cursor
magnifier|magnifier settings|ms-settings:easeofaccess-magnifier
colorfilters|color filters,colour filters,color blind|ms-settings:easeofaccess-colorfilter
contrast|contrast themes,high contrast settings|ms-settings:easeofaccess-highcontrast
narrator|narrator settings,screen reader settings|ms-settings:easeofaccess-narrator
audioaccess|mono audio,accessibility audio|ms-settings:easeofaccess-audio
captions|captions,live captions,subtitles|ms-settings:easeofaccess-closedcaptioning
voiceaccess|voice access|ms-settings:easeofaccess-speechrecognition
keyboardaccess|sticky keys,filter keys,accessibility keyboard|ms-settings:easeofaccess-keyboard
mouseaccess|mouse keys|ms-settings:easeofaccess-mouse
eyecontrol|eye control|ms-settings:easeofaccess-eyecontrol
privacy|privacy,privacy and security,security settings|ms-settings:privacy
windowssecurity|windows security,defender,antivirus,virus protection|ms-settings:windowsdefender
findmydevice|find my device settings|ms-settings:findmydevice
developers|for developers,developer mode,developer settings|ms-settings:developers
microphone|microphone,mic,microphone privacy,mic permissions,microphone access|ms-settings:privacy-microphone
camera|camera privacy,camera permissions,camera access|ms-settings:privacy-webcam
location|location,location services,gps|ms-settings:privacy-location
diagnostics|diagnostics and feedback,telemetry,diagnostic data|ms-settings:privacy-feedback
activityhistory|activity history|ms-settings:privacy-activityhistory
searchpermissions|search permissions,safe search|ms-settings:search-permissions
searchindexing|searching windows,search indexing,indexing|ms-settings:cortana-windowssearch
generalprivacy|general privacy,advertising id|ms-settings:privacy-general
appdiagnostics|app diagnostics|ms-settings:privacy-appdiagnostics
notificationsaccess|notification access|ms-settings:privacy-notifications
contactsaccess|contacts access,contacts permissions|ms-settings:privacy-contacts
calendaraccess|calendar access,calendar permissions|ms-settings:privacy-calendar
filesaccess|file system access|ms-settings:privacy-broadfilesystemaccess
updates|updates,windows update,update,check for updates|ms-settings:windowsupdate
updatehistory|update history|ms-settings:windowsupdate-history
updateoptions|advanced update options,update options|ms-settings:windowsupdate-options
activehours|active hours|ms-settings:windowsupdate-activehours
deliveryoptimization|delivery optimization|ms-settings:delivery-optimization
insider|windows insider program,insider program|ms-settings:windowsinsider
`;

export interface SettingsPage { id: string; names: string[]; uri: string }

export const SETTINGS_PAGES: SettingsPage[] = SETTINGS_RAW.trim().split('\n').map((l) => {
  const [id, names, uri] = l.split('|');
  return { id, names: names.split(',').map((n) => n.trim()), uri: uri.trim() };
});

export const SETTINGS_BY_ID = new Map(SETTINGS_PAGES.map((p) => [p.id, p]));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const SETTINGS_INDEX = new Map<string, SettingsPage>();
for (const p of SETTINGS_PAGES) for (const n of [p.id, ...p.names]) { const k = norm(n); if (!SETTINGS_INDEX.has(k)) SETTINGS_INDEX.set(k, p); }

/** "bluetooth", "the dark mode", "windows update" → settings page. */
export function findSettingsPage(query: string): SettingsPage | null {
  const q = norm(query).replace(/^(the|my|windows) /, '').replace(/ (settings?|page|options|menu)$/, '').trim();
  return SETTINGS_INDEX.get(q) ?? SETTINGS_INDEX.get(norm(query)) ?? null;
}

/**
 * Built-in Windows tools. `exe` is relative to System32 unless it starts with '%'.
 * Args are fixed; nothing from the user is appended.
 */
const TOOLS_RAW = `
devicemanager|device manager,devices manager,drivers|mmc.exe|devmgmt.msc
diskmanagement|disk management,partitions,disk manager|mmc.exe|diskmgmt.msc
computermanagement|computer management|mmc.exe|compmgmt.msc
eventviewer|event viewer,event log,windows logs|mmc.exe|eventvwr.msc
services|services,windows services|mmc.exe|services.msc
taskscheduler|task scheduler,scheduled tasks|mmc.exe|taskschd.msc
firewall|windows firewall,firewall,advanced firewall|mmc.exe|wf.msc
performancemonitor|performance monitor,perfmon|perfmon.exe|
resourcemonitor|resource monitor,resmon|resmon.exe|
systeminfo|system information,msinfo,system info|msinfo32.exe|
dxdiag|directx diagnostic,dxdiag,directx|dxdiag.exe|
controlpanel|control panel|control.exe|
systemproperties|system properties,advanced system settings|SystemPropertiesAdvanced.exe|
envvars|environment variables,path variable|rundll32.exe|sysdm.cpl,EditEnvironmentVariables
performanceoptions|performance options,visual performance|SystemPropertiesPerformance.exe|
remotesettings|remote settings,remote assistance settings|SystemPropertiesRemote.exe|
systemprotection|system protection,restore point,create a restore point|SystemPropertiesProtection.exe|
systemrestore|system restore|rstrui.exe|
diskcleanup|disk cleanup,clean up disk,cleanmgr|cleanmgr.exe|
defrag|defragment,defrag,optimize drives,disk optimization|dfrgui.exe|
memorydiagnostic|memory diagnostic,ram test,windows memory diagnostic|MdSched.exe|
charmap|character map,special characters,charmap|charmap.exe|
osk|on screen keyboard,onscreen keyboard,virtual keyboard|osk.exe|
magnifier|magnifier,zoom tool|Magnify.exe|
narrator|narrator,screen reader|Narrator.exe|
stepsrecorder|steps recorder,problem steps recorder|psr.exe|
remotedesktopclient|remote desktop connection,mstsc|mstsc.exe|
quickassist|quick assist,remote help|quickassist.exe|
soundcontrol|sound control panel,playback devices,recording devices|control.exe|mmsys.cpl
networkconnections|network connections,network adapters panel|control.exe|ncpa.cpl
poweroptions|power options,power plan,power plans|control.exe|powercfg.cpl
programsfeatures|programs and features,uninstall a program|control.exe|appwiz.cpl
mouseproperties|mouse properties,mouse control panel|control.exe|main.cpl
internetoptions|internet options,internet properties|control.exe|inetcpl.cpl
datetimepanel|date and time control panel|control.exe|timedate.cpl
windowsfeatures|windows features,turn windows features on or off|OptionalFeatures.exe|
credentialmanager|credential manager,saved passwords windows|control.exe|/name Microsoft.CredentialManager
useraccounts|user accounts control panel|control.exe|/name Microsoft.UserAccounts
deviceprinters|devices and printers|control.exe|/name Microsoft.DevicesAndPrinters
fontsfolder|fonts folder,font viewer|control.exe|/name Microsoft.Fonts
colormanagement|color management,display calibration|colorcpl.exe|
calibratedisplay|calibrate display color,display calibration tool|dccw.exe|
cleartype|cleartype,text tuner|cttune.exe|
iscsi|iscsi initiator|iscsicpl.exe|
odbc|odbc data sources|odbcad32.exe|
reliability|reliability monitor,reliability history|perfmon.exe|/rel
securitycenter|windows security app,security center|%windir%\\explorer.exe|windowsdefender:
wordpad|wordpad,word pad|write.exe|
notepadtool|notepad|notepad.exe|
paintapp|paint|mspaint.exe|
snipping|snipping tool,screenshot|SnippingTool.exe|
calculatortool|calculator|calc.exe|
`;

export interface WinTool { id: string; names: string[]; exe: string; args: string[] }

export const WIN_TOOLS: WinTool[] = TOOLS_RAW.trim().split('\n').map((l) => {
  const [id, names, exe, args] = l.split('|');
  return { id, names: names.split(',').map((n) => n.trim()), exe: exe.trim(), args: args?.trim() ? args.trim().split(' ') : [] };
});

export const WIN_TOOLS_BY_ID = new Map(WIN_TOOLS.map((t) => [t.id, t]));

const TOOL_INDEX = new Map<string, WinTool>();
for (const t of WIN_TOOLS) for (const n of t.names) { const k = norm(n); if (!TOOL_INDEX.has(k)) TOOL_INDEX.set(k, t); }

export function findWinTool(query: string): WinTool | null {
  const q = norm(query).replace(/^(the|my|windows) /, '').replace(/ (app|tool|utility|panel)$/, '').trim();
  return TOOL_INDEX.get(q) ?? TOOL_INDEX.get(norm(query)) ?? null;
}

/** Shell folders opened with explorer.exe shell:<name>. */
const FOLDERS_RAW = `
recyclebin|recycle bin,trash,bin,deleted files|shell:RecycleBinFolder
thispc|this pc,my computer,computer,drives|shell:MyComputerFolder
network|network folder,network places|shell:NetworkPlacesFolder
appsfolder|all apps,applications folder,apps folder|shell:AppsFolder
startup|startup folder|shell:Startup
appdata|appdata,app data,roaming folder|shell:AppData
localappdata|local appdata,local app data|shell:Local AppData
temp|temp folder,temporary files folder|shell:Cache
programfiles|program files|shell:ProgramFiles
programfilesx86|program files x86|shell:ProgramFilesX86
windowsfolder|windows folder|shell:Windows
system32|system32,system 32|shell:System
fonts|fonts folder|shell:Fonts
startmenu|start menu folder|shell:Start Menu
sendto|send to folder|shell:SendTo
recent|recent files,recent items,recent folder|shell:Recent
favorites|favorites,favourites|shell:Favorites
links|links folder|shell:Links
contacts|contacts folder|shell:Contacts
savedgames|saved games|shell:SavedGames
screenshots|screenshots,screenshots folder,my screenshots|shell:Screenshots
cameraroll|camera roll|shell:Camera Roll
onedrive|onedrive folder|shell:OneDrive
quickaccess|quick access,home folder explorer|shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}
libraries|libraries|shell:Libraries
userprofile|user folder,profile folder|shell:Profile
public|public folder|shell:Public
templates|templates folder|shell:Templates
printersfolder|printers folder|shell:PrintersFolder
controlpanelfolder|all control panel items|shell:ControlPanelFolder
godmode|god mode,all settings|shell:::{ED7BA470-8E54-465E-825C-99712043E01C}
`;

export interface ShellFolder { id: string; names: string[]; shell: string }

export const SHELL_FOLDERS: ShellFolder[] = FOLDERS_RAW.trim().split('\n').map((l) => {
  const [id, names, shell] = l.split('|');
  return { id, names: names.split(',').map((n) => n.trim()), shell: shell.trim() };
});

export const SHELL_FOLDERS_BY_ID = new Map(SHELL_FOLDERS.map((f) => [f.id, f]));

const FOLDER_INDEX = new Map<string, ShellFolder>();
for (const f of SHELL_FOLDERS) for (const n of f.names) { const k = norm(n); if (!FOLDER_INDEX.has(k)) FOLDER_INDEX.set(k, f); }

export function findShellFolder(query: string): ShellFolder | null {
  const q = norm(query).replace(/^(the|my) /, '').trim();
  return FOLDER_INDEX.get(q) ?? FOLDER_INDEX.get(q.replace(/ folder$/, '')) ?? null;
}
