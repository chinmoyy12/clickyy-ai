import { SITES, SEARCH_SITES } from './sites';
import { SETTINGS_PAGES, SHELL_FOLDERS, WIN_TOOLS } from './windows';
import { CITY_ZONES } from './cities';
import { CURRENCY_WORDS } from '../../tools/extras';
import { CATALOG } from '../catalog';
import { startAppCount } from '../../tools/apps';

export interface CapabilityCounts {
  commands: number; tools: number; websites: number; siteSearches: number; settingsPages: number;
  windowsTools: number; specialFolders: number; worldClockPlaces: number; currencies: number; startApps: number; total: number;
}

/**
 * Real, individually testable things Clickyy can do: each website, Settings page, Windows tool,
 * folder and world-clock place is a distinct target that opens or answers. Start-menu apps
 * depend on the PC and are counted separately.
 */
export function capabilityCounts(toolCount: number): CapabilityCounts {
  const c = {
    commands: CATALOG.filter((x) => x.patterns.length).length,
    tools: toolCount,
    websites: SITES.length,
    siteSearches: SEARCH_SITES.length,
    settingsPages: SETTINGS_PAGES.length,
    windowsTools: WIN_TOOLS.length,
    specialFolders: SHELL_FOLDERS.length,
    worldClockPlaces: CITY_ZONES.size,
    currencies: new Set(Object.values(CURRENCY_WORDS)).size,
    startApps: startAppCount(),
  };
  return { ...c, total: c.commands + c.websites + c.siteSearches + c.settingsPages + c.windowsTools + c.specialFolders + c.worldClockPlaces + c.currencies };
}
