/** Cities and countries → IANA time zone, for the offline world clock ("what time is it in tokyo"). */
const RAW = `
new york,nyc,new york city,manhattan,brooklyn,boston,washington,washington dc,philadelphia,miami,atlanta,detroit,toronto,montreal,ottawa,orlando,charlotte,pittsburgh,eastern time,est,edt|America/New_York
chicago,houston,dallas,austin,san antonio,minneapolis,new orleans,kansas city,st louis,nashville,milwaukee,winnipeg,mexico city,central time,cst,cdt|America/Chicago
denver,salt lake city,calgary,edmonton,albuquerque,boise,mountain time,mst|America/Denver
phoenix,arizona|America/Phoenix
los angeles,la,san francisco,sf,seattle,portland,las vegas,san diego,san jose,vancouver,silicon valley,hollywood,sacramento,pacific time,pst,pdt,california|America/Los_Angeles
anchorage,alaska|America/Anchorage
honolulu,hawaii|Pacific/Honolulu
sao paulo,rio,rio de janeiro,brasilia,brazil|America/Sao_Paulo
buenos aires,argentina|America/Argentina/Buenos_Aires
santiago,chile|America/Santiago
lima,peru|America/Lima
bogota,colombia|America/Bogota
caracas,venezuela|America/Caracas
havana,cuba|America/Havana
halifax,atlantic time|America/Halifax
st johns,newfoundland|America/St_Johns
london,uk,united kingdom,england,britain,manchester,liverpool,birmingham,edinburgh,glasgow,gmt,bst|Europe/London
dublin,ireland|Europe/Dublin
lisbon,portugal|Europe/Lisbon
paris,france,lyon,marseille|Europe/Paris
berlin,germany,munich,frankfurt,hamburg,cologne|Europe/Berlin
amsterdam,netherlands,rotterdam|Europe/Amsterdam
brussels,belgium|Europe/Brussels
madrid,spain,barcelona,valencia,seville|Europe/Madrid
rome,italy,milan,naples,venice,florence|Europe/Rome
zurich,geneva,switzerland,bern|Europe/Zurich
vienna,austria|Europe/Vienna
prague,czech republic,czechia|Europe/Prague
warsaw,poland,krakow|Europe/Warsaw
budapest,hungary|Europe/Budapest
stockholm,sweden|Europe/Stockholm
oslo,norway|Europe/Oslo
copenhagen,denmark|Europe/Copenhagen
helsinki,finland|Europe/Helsinki
athens,greece|Europe/Athens
istanbul,turkey,ankara|Europe/Istanbul
kyiv,kiev,ukraine|Europe/Kyiv
moscow,russia,saint petersburg,st petersburg|Europe/Moscow
bucharest,romania|Europe/Bucharest
sofia,bulgaria|Europe/Sofia
belgrade,serbia|Europe/Belgrade
reykjavik,iceland|Atlantic/Reykjavik
cairo,egypt|Africa/Cairo
lagos,nigeria,abuja|Africa/Lagos
nairobi,kenya|Africa/Nairobi
johannesburg,cape town,south africa,pretoria,durban|Africa/Johannesburg
casablanca,morocco|Africa/Casablanca
accra,ghana|Africa/Accra
addis ababa,ethiopia|Africa/Addis_Ababa
dubai,abu dhabi,uae,united arab emirates|Asia/Dubai
doha,qatar|Asia/Qatar
riyadh,saudi arabia,jeddah,mecca|Asia/Riyadh
kuwait|Asia/Kuwait
tehran,iran|Asia/Tehran
jerusalem,tel aviv,israel|Asia/Jerusalem
baghdad,iraq|Asia/Baghdad
karachi,lahore,islamabad,pakistan|Asia/Karachi
kabul,afghanistan|Asia/Kabul
india,delhi,new delhi,mumbai,bombay,bangalore,bengaluru,chennai,madras,kolkata,calcutta,hyderabad,pune,ahmedabad,jaipur,lucknow,guwahati,surat,kochi,chandigarh,bhopal,indore,patna,nagpur,noida,gurgaon,gurugram,ist|Asia/Kolkata
kathmandu,nepal|Asia/Kathmandu
dhaka,bangladesh|Asia/Dhaka
colombo,sri lanka|Asia/Colombo
thimphu,bhutan|Asia/Thimphu
yangon,myanmar|Asia/Yangon
bangkok,thailand|Asia/Bangkok
hanoi,ho chi minh city,saigon,vietnam|Asia/Ho_Chi_Minh
jakarta,indonesia|Asia/Jakarta
kuala lumpur,malaysia|Asia/Kuala_Lumpur
singapore|Asia/Singapore
manila,philippines|Asia/Manila
beijing,shanghai,china,shenzhen,guangzhou,chengdu|Asia/Shanghai
hong kong|Asia/Hong_Kong
taipei,taiwan|Asia/Taipei
seoul,south korea,korea,busan|Asia/Seoul
tokyo,japan,osaka,kyoto|Asia/Tokyo
ulaanbaatar,mongolia|Asia/Ulaanbaatar
tashkent,uzbekistan|Asia/Tashkent
almaty,kazakhstan|Asia/Almaty
perth|Australia/Perth
adelaide|Australia/Adelaide
darwin|Australia/Darwin
brisbane,queensland|Australia/Brisbane
sydney,australia,canberra,melbourne|Australia/Sydney
hobart,tasmania|Australia/Hobart
auckland,wellington,new zealand|Pacific/Auckland
fiji|Pacific/Fiji
utc,coordinated universal time,zulu time|UTC
`;

export const CITY_ZONES = new Map<string, string>();
for (const line of RAW.trim().split('\n')) {
  const [names, zone] = line.split('|');
  for (const n of names.split(',')) CITY_ZONES.set(n.trim(), zone.trim());
}

export function findZone(place: string): string | null {
  const q = place.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the )/, '');
  return CITY_ZONES.get(q) ?? null;
}
