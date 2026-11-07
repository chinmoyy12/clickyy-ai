/**
 * Well-known websites and web apps Clickyy can open by name ("open yt music").
 * Format per line: Display name | spoken aliases (comma separated) | address.
 * Every address is a plain https site; nothing here is executed.
 */
const RAW = `
YouTube|youtube,you tube,yt|www.youtube.com
YouTube Music|youtube music,yt music,you tube music,ytm,yt musics|music.youtube.com
YouTube Studio|youtube studio,yt studio|studio.youtube.com
YouTube Kids|youtube kids|www.youtubekids.com
Gmail|gmail,g mail,google mail,my email,my mail|mail.google.com
Google|google,google search|www.google.com
Google Drive|google drive,drive,my drive|drive.google.com
Google Docs|google docs,docs|docs.google.com/document
Google Sheets|google sheets,sheets|docs.google.com/spreadsheets
Google Slides|google slides,slides|docs.google.com/presentation
Google Forms|google forms,forms|docs.google.com/forms
Google Calendar|google calendar,calendar,my calendar|calendar.google.com
Google Maps|google maps,maps|maps.google.com
Google Photos|google photos,photos online|photos.google.com
Google Keep|google keep,keep,keep notes|keep.google.com
Google Translate|google translate,translate,translator|translate.google.com
Google Meet|google meet,meet|meet.google.com
Google Classroom|google classroom,classroom|classroom.google.com
Google News|google news|news.google.com
Google Earth|google earth|earth.google.com
Google Contacts|google contacts,contacts|contacts.google.com
Google Account|google account,my google account|myaccount.google.com
Google Play|google play,play store|play.google.com
Google Scholar|google scholar,scholar|scholar.google.com
Google Books|google books|books.google.com
Google Flights|google flights,flights|www.google.com/travel/flights
Google Finance|google finance|www.google.com/finance
Google Fonts|google fonts|fonts.google.com
Google Analytics|google analytics,analytics|analytics.google.com
Google Ads|google ads,adwords|ads.google.com
Google Cloud Console|google cloud,gcp,google cloud console|console.cloud.google.com
Firebase|firebase,firebase console|console.firebase.google.com
Google Colab|google colab,colab|colab.research.google.com
Gemini|gemini,google gemini,bard|gemini.google.com
Google AI Studio|ai studio,google ai studio|aistudio.google.com
NotebookLM|notebooklm,notebook lm|notebooklm.google.com
Blogger|blogger|www.blogger.com
Google Sites|google sites|sites.google.com
Outlook|outlook,outlook mail,hotmail,outlook web|outlook.live.com
Outlook Calendar|outlook calendar|outlook.live.com/calendar
Microsoft 365|microsoft 365,office,office 365,office online|www.office.com
Word Online|word online|www.office.com/launch/word
Excel Online|excel online|www.office.com/launch/excel
PowerPoint Online|powerpoint online|www.office.com/launch/powerpoint
OneDrive|onedrive,one drive|onedrive.live.com
OneNote Online|onenote online,onenote web|www.onenote.com
Microsoft Teams Web|teams web,teams online|teams.microsoft.com
Microsoft To Do Web|to do web,microsoft to do online|to-do.live.com
Microsoft Account|microsoft account,my microsoft account|account.microsoft.com
Bing|bing,bing search|www.bing.com
Copilot|copilot,microsoft copilot,bing chat|copilot.microsoft.com
MSN|msn|www.msn.com
Xbox|xbox,xbox website|www.xbox.com
Xbox Cloud Gaming|xbox cloud gaming,xcloud,cloud gaming|www.xbox.com/play
Microsoft Learn|microsoft learn,ms learn,msdn,microsoft docs|learn.microsoft.com
Azure Portal|azure,azure portal|portal.azure.com
Microsoft Rewards|microsoft rewards,bing rewards|rewards.bing.com
LinkedIn|linkedin,linked in|www.linkedin.com
LinkedIn Learning|linkedin learning|www.linkedin.com/learning
GitHub|github,git hub|github.com
GitHub Copilot|github copilot|github.com/features/copilot
GitHub Gist|gist,github gist|gist.github.com
GitLab|gitlab,git lab|gitlab.com
Bitbucket|bitbucket|bitbucket.org
Stack Overflow|stack overflow,stackoverflow|stackoverflow.com
Stack Exchange|stack exchange|stackexchange.com
Super User|super user,superuser|superuser.com
Ask Ubuntu|ask ubuntu|askubuntu.com
Hacker News|hacker news,hn,y combinator news|news.ycombinator.com
Dev.to|dev to,dev community|dev.to
Hashnode|hashnode|hashnode.com
Medium|medium|medium.com
Substack|substack|substack.com
MDN Web Docs|mdn,mdn web docs,mozilla docs|developer.mozilla.org
W3Schools|w3schools,w three schools|www.w3schools.com
freeCodeCamp|freecodecamp,free code camp|www.freecodecamp.org
GeeksforGeeks|geeksforgeeks,geeks for geeks|www.geeksforgeeks.org
LeetCode|leetcode,leet code|leetcode.com
HackerRank|hackerrank,hacker rank|www.hackerrank.com
Codeforces|codeforces,code forces|codeforces.com
CodeChef|codechef,code chef|www.codechef.com
AtCoder|atcoder|atcoder.jp
Kaggle|kaggle|www.kaggle.com
Hugging Face|hugging face,huggingface|huggingface.co
Replit|replit,repl it|replit.com
CodePen|codepen,code pen|codepen.io
CodeSandbox|codesandbox,code sandbox|codesandbox.io
JSFiddle|jsfiddle,js fiddle|jsfiddle.net
StackBlitz|stackblitz,stack blitz|stackblitz.com
npm|npm,npmjs,npm registry|www.npmjs.com
PyPI|pypi,python package index|pypi.org
Python|python,python docs,python website|www.python.org
Node.js|node js,nodejs,node website|nodejs.org
React|react docs,react website|react.dev
Vue.js|vue,vue js|vuejs.org
Angular|angular|angular.dev
Svelte|svelte|svelte.dev
Next.js|next js,nextjs|nextjs.org
TypeScript|typescript,typescript docs|www.typescriptlang.org
Rust|rust lang,rust website|www.rust-lang.org
Go|golang,go lang|go.dev
Java|java,java download|www.java.com
Oracle|oracle|www.oracle.com
Docker Hub|docker hub|hub.docker.com
Docker|docker website,docker docs|docs.docker.com
Kubernetes|kubernetes,k8s|kubernetes.io
Vercel|vercel|vercel.com
Netlify|netlify|www.netlify.com
Heroku|heroku|www.heroku.com
Render|render dot com|render.com
Railway|railway app|railway.app
Cloudflare|cloudflare,cloudflare dashboard|dash.cloudflare.com
DigitalOcean|digitalocean,digital ocean|cloud.digitalocean.com
AWS Console|aws,aws console,amazon web services|console.aws.amazon.com
Supabase|supabase|supabase.com
MongoDB Atlas|mongodb,mongo db,atlas|cloud.mongodb.com
Postman|postman web|web.postman.co
Jira|jira|www.atlassian.com/software/jira
Confluence|confluence|www.atlassian.com/software/confluence
Trello|trello|trello.com
Asana|asana|app.asana.com
Notion|notion|www.notion.so
Linear|linear app|linear.app
ClickUp|clickup,click up|app.clickup.com
Monday|monday dot com,monday|monday.com
Todoist|todoist|app.todoist.com
Airtable|airtable|airtable.com
Miro|miro,miro board|miro.com
Figma|figma|www.figma.com
Canva|canva|www.canva.com
Adobe Express|adobe express|new.express.adobe.com
Adobe|adobe|www.adobe.com
Behance|behance|www.behance.net
Dribbble|dribbble,dribble|dribbble.com
Pinterest|pinterest|www.pinterest.com
Unsplash|unsplash|unsplash.com
Pexels|pexels|www.pexels.com
Pixabay|pixabay|pixabay.com
Freepik|freepik|www.freepik.com
Remove.bg|remove bg,remove background|www.remove.bg
Photopea|photopea|www.photopea.com
Excalidraw|excalidraw|excalidraw.com
draw.io|draw io,diagrams|app.diagrams.net
Lucidchart|lucidchart,lucid chart|www.lucidchart.com
Grammarly|grammarly|app.grammarly.com
QuillBot|quillbot,quill bot|quillbot.com
Overleaf|overleaf,latex editor|www.overleaf.com
Wolfram Alpha|wolfram alpha,wolfram|www.wolframalpha.com
Desmos|desmos,graphing calculator|www.desmos.com/calculator
GeoGebra|geogebra|www.geogebra.org
Symbolab|symbolab|www.symbolab.com
Khan Academy|khan academy,khan|www.khanacademy.org
Coursera|coursera|www.coursera.org
edX|edx,ed x|www.edx.org
Udemy|udemy|www.udemy.com
Skillshare|skillshare|www.skillshare.com
Duolingo|duolingo|www.duolingo.com
Brilliant|brilliant|brilliant.org
Codecademy|codecademy,code academy|www.codecademy.com
Quizlet|quizlet|quizlet.com
Chegg|chegg|www.chegg.com
Brainly|brainly|brainly.com
Course Hero|course hero|www.coursehero.com
Byju's|byjus|byjus.com
Unacademy|unacademy|unacademy.com
Physics Wallah|physics wallah,pw|www.pw.live
NPTEL|nptel|nptel.ac.in
SWAYAM|swayam|swayam.gov.in
MIT OpenCourseWare|mit opencourseware,ocw|ocw.mit.edu
Wikipedia|wikipedia,wiki|www.wikipedia.org
Wiktionary|wiktionary|www.wiktionary.org
Wikimedia Commons|wikimedia commons|commons.wikimedia.org
Internet Archive|internet archive,archive org,wayback machine|archive.org
Project Gutenberg|project gutenberg,gutenberg|www.gutenberg.org
Goodreads|goodreads|www.goodreads.com
Dictionary.com|dictionary,dictionary dot com|www.dictionary.com
Merriam-Webster|merriam webster,webster|www.merriam-webster.com
Thesaurus.com|thesaurus|www.thesaurus.com
Cambridge Dictionary|cambridge dictionary|dictionary.cambridge.org
Oxford Learner's Dictionaries|oxford dictionary|www.oxfordlearnersdictionaries.com
Urban Dictionary|urban dictionary|www.urbandictionary.com
ChatGPT|chatgpt,chat gpt,openai chat|chatgpt.com
OpenAI Platform|openai platform,openai api|platform.openai.com
Claude|claude,claude ai,anthropic claude|claude.ai
Anthropic Console|anthropic console,claude console|console.anthropic.com
Perplexity|perplexity,perplexity ai|www.perplexity.ai
Microsoft Designer|microsoft designer,designer|designer.microsoft.com
Midjourney|midjourney,mid journey|www.midjourney.com
Leonardo AI|leonardo ai,leonardo|app.leonardo.ai
DeepSeek|deepseek chat,deep seek|chat.deepseek.com
Grok|grok,x ai chat|grok.com
Mistral Le Chat|le chat,mistral chat|chat.mistral.ai
Poe|poe,poe ai|poe.com
Character AI|character ai,character dot ai|character.ai
Suno|suno,suno ai|suno.com
ElevenLabs|elevenlabs,eleven labs|elevenlabs.io
Runway|runway ml,runway ai|runwayml.com
Groq Console|groq console|console.groq.com
OpenRouter|openrouter,open router|openrouter.ai
Ollama|ollama website,ollama library|ollama.com
LM Studio|lm studio website|lmstudio.ai
Reddit|reddit|www.reddit.com
X|twitter,x dot com,x|x.com
Facebook|facebook,fb|www.facebook.com
Messenger|messenger,facebook messenger|www.messenger.com
Instagram|instagram,insta|www.instagram.com
Threads|threads|www.threads.net
WhatsApp Web|whatsapp,whatsapp web,whats app|web.whatsapp.com
Telegram Web|telegram web,telegram|web.telegram.org
Discord Web|discord web|discord.com/app
Snapchat|snapchat web,snapchat|web.snapchat.com
TikTok|tiktok,tik tok|www.tiktok.com
Tumblr|tumblr|www.tumblr.com
Quora|quora|www.quora.com
Mastodon|mastodon|joinmastodon.org
Bluesky|bluesky,blue sky|bsky.app
Slack Web|slack web|app.slack.com
Zoom Web|zoom web,zoom website|zoom.us
Skype Web|skype web|web.skype.com
Signal|signal website|signal.org
Twitch|twitch|www.twitch.tv
Kick|kick dot com,kick streaming|kick.com
Netflix|netflix|www.netflix.com
Amazon Prime Video|prime video,amazon prime video,prime|www.primevideo.com
Disney+|disney plus,disney+,disney hotstar|www.disneyplus.com
JioHotstar|hotstar,jiohotstar,jio hotstar|www.hotstar.com
Hulu|hulu|www.hulu.com
Max|hbo max,max,hbo|www.max.com
Apple TV|apple tv,apple tv plus|tv.apple.com
Paramount+|paramount plus,paramount|www.paramountplus.com
Peacock|peacock|www.peacocktv.com
Crunchyroll|crunchyroll,crunchy roll|www.crunchyroll.com
SonyLIV|sonyliv,sony liv|www.sonyliv.com
ZEE5|zee5,zee 5|www.zee5.com
JioCinema|jiocinema,jio cinema|www.jiocinema.com
MX Player|mx player|www.mxplayer.in
Vimeo|vimeo|vimeo.com
Dailymotion|dailymotion|www.dailymotion.com
Plex|plex|app.plex.tv
IMDb|imdb,i m d b|www.imdb.com
Rotten Tomatoes|rotten tomatoes|www.rottentomatoes.com
Letterboxd|letterboxd|letterboxd.com
JustWatch|justwatch,just watch|www.justwatch.com
MyAnimeList|myanimelist,my anime list|myanimelist.net
Spotify Web|spotify web,open spotify|open.spotify.com
Apple Music|apple music|music.apple.com
Amazon Music|amazon music|music.amazon.com
SoundCloud|soundcloud,sound cloud|soundcloud.com
JioSaavn|jiosaavn,saavn,jio saavn|www.jiosaavn.com
Gaana|gaana|gaana.com
Wynk Music|wynk,wynk music|wynk.in
Deezer|deezer|www.deezer.com
Tidal|tidal|listen.tidal.com
Pandora|pandora|www.pandora.com
Bandcamp|bandcamp|bandcamp.com
Last.fm|last fm,lastfm|www.last.fm
Genius|genius,genius lyrics,lyrics|genius.com
Shazam|shazam|www.shazam.com
Audible|audible|www.audible.com
Pocket Casts|pocket casts|play.pocketcasts.com
TuneIn|tunein,tune in radio|tunein.com
Amazon|amazon,amazon shopping|www.amazon.com
Amazon India|amazon india,amazon in|www.amazon.in
Flipkart|flipkart|www.flipkart.com
Myntra|myntra|www.myntra.com
Meesho|meesho|www.meesho.com
Ajio|ajio|www.ajio.com
Nykaa|nykaa|www.nykaa.com
Snapdeal|snapdeal|www.snapdeal.com
Tata CLiQ|tata cliq|www.tatacliq.com
Croma|croma|www.croma.com
Reliance Digital|reliance digital|www.reliancedigital.in
BigBasket|bigbasket,big basket|www.bigbasket.com
Blinkit|blinkit|blinkit.com
Zepto|zepto|www.zeptonow.com
JioMart|jiomart,jio mart|www.jiomart.com
Swiggy|swiggy|www.swiggy.com
Zomato|zomato|www.zomato.com
eBay|ebay,e bay|www.ebay.com
Walmart|walmart|www.walmart.com
Target|target store|www.target.com
Best Buy|best buy,bestbuy|www.bestbuy.com
Costco|costco|www.costco.com
Etsy|etsy|www.etsy.com
AliExpress|aliexpress,ali express|www.aliexpress.com
Alibaba|alibaba|www.alibaba.com
Temu|temu|www.temu.com
Shein|shein|www.shein.com
IKEA|ikea|www.ikea.com
Newegg|newegg,new egg|www.newegg.com
Uber Eats|uber eats|www.ubereats.com
DoorDash|doordash,door dash|www.doordash.com
Instacart|instacart|www.instacart.com
Grubhub|grubhub|www.grubhub.com
Domino's|dominos,domino's pizza|www.dominos.com
Pizza Hut|pizza hut|www.pizzahut.com
McDonald's|mcdonalds,mc donalds|www.mcdonalds.com
Starbucks|starbucks|www.starbucks.com
Uber|uber|www.uber.com
Ola|ola cabs,ola|www.olacabs.com
Rapido|rapido|www.rapido.bike
Lyft|lyft|www.lyft.com
Airbnb|airbnb,air bnb|www.airbnb.com
Booking.com|booking,booking dot com|www.booking.com
Expedia|expedia|www.expedia.com
Tripadvisor|tripadvisor,trip advisor|www.tripadvisor.com
Agoda|agoda|www.agoda.com
Trivago|trivago|www.trivago.com
Kayak|kayak|www.kayak.com
Skyscanner|skyscanner,sky scanner|www.skyscanner.net
MakeMyTrip|makemytrip,make my trip|www.makemytrip.com
Goibibo|goibibo|www.goibibo.com
Cleartrip|cleartrip|www.cleartrip.com
ixigo|ixigo|www.ixigo.com
IRCTC|irctc,train tickets,indian railways|www.irctc.co.in
RedBus|redbus,red bus|www.redbus.in
OYO|oyo,oyo rooms|www.oyorooms.com
Indigo|indigo airlines,indigo|www.goindigo.in
Air India|air india|www.airindia.com
Emirates|emirates|www.emirates.com
Delta|delta airlines|www.delta.com
United Airlines|united airlines|www.united.com
American Airlines|american airlines|www.aa.com
Flightradar24|flightradar,flight radar,flightradar24|www.flightradar24.com
Google Travel|google travel|www.google.com/travel
Zillow|zillow|www.zillow.com
Redfin|redfin|www.redfin.com
Realtor.com|realtor|www.realtor.com
99acres|99acres,ninety nine acres|www.99acres.com
MagicBricks|magicbricks,magic bricks|www.magicbricks.com
Housing.com|housing dot com|housing.com
NoBroker|nobroker,no broker|www.nobroker.in
Craigslist|craigslist|www.craigslist.org
OLX|olx|www.olx.in
Quikr|quikr|www.quikr.com
Indeed|indeed|www.indeed.com
Glassdoor|glassdoor|www.glassdoor.com
Naukri|naukri,naukri dot com|www.naukri.com
Monster|monster jobs|www.foundit.in
Internshala|internshala|internshala.com
Wellfound|angellist,wellfound|wellfound.com
Upwork|upwork|www.upwork.com
Fiverr|fiverr|www.fiverr.com
Freelancer|freelancer dot com|www.freelancer.com
Toptal|toptal|www.toptal.com
PayPal|paypal,pay pal|www.paypal.com
Stripe Dashboard|stripe,stripe dashboard|dashboard.stripe.com
Wise|wise,transferwise|wise.com
Revolut|revolut|www.revolut.com
Paytm|paytm|paytm.com
PhonePe|phonepe,phone pe|www.phonepe.com
Google Pay|google pay,gpay|pay.google.com
Razorpay|razorpay|dashboard.razorpay.com
Zerodha Kite|zerodha,kite,zerodha kite|kite.zerodha.com
Groww|groww|groww.in
Upstox|upstox|upstox.com
Angel One|angel one,angel broking|www.angelone.in
TradingView|tradingview,trading view|www.tradingview.com
Moneycontrol|moneycontrol,money control|www.moneycontrol.com
Economic Times|economic times,et|economictimes.indiatimes.com
Yahoo Finance|yahoo finance|finance.yahoo.com
Bloomberg|bloomberg|www.bloomberg.com
CNBC|cnbc|www.cnbc.com
MarketWatch|marketwatch,market watch|www.marketwatch.com
Investing.com|investing dot com|www.investing.com
Morningstar|morningstar|www.morningstar.com
Robinhood|robinhood|robinhood.com
Coinbase|coinbase|www.coinbase.com
Binance|binance|www.binance.com
CoinMarketCap|coinmarketcap,coin market cap|coinmarketcap.com
CoinGecko|coingecko,coin gecko|www.coingecko.com
WazirX|wazirx|wazirx.com
CoinDCX|coindcx|coindcx.com
Mint|intuit mint,credit karma|www.creditkarma.com
CRED|cred|cred.club
SBI Online|sbi,sbi online,state bank|onlinesbi.sbi
HDFC Bank|hdfc,hdfc bank|www.hdfcbank.com
ICICI Bank|icici,icici bank|www.icicibank.com
Axis Bank|axis bank|www.axisbank.com
Kotak Bank|kotak,kotak bank|www.kotak.com
Chase|chase,chase bank|www.chase.com
Bank of America|bank of america|www.bankofamerica.com
Wells Fargo|wells fargo|www.wellsfargo.com
Citi|citi,citibank|www.citi.com
Income Tax India|income tax,income tax portal,itr|www.incometax.gov.in
GST Portal|gst,gst portal|www.gst.gov.in
DigiLocker|digilocker,digi locker|www.digilocker.gov.in
UIDAI|aadhaar,uidai|uidai.gov.in
Passport Seva|passport seva,passport india|www.passportindia.gov.in
EPFO|epfo,pf,provident fund|www.epfindia.gov.in
UMANG|umang|web.umang.gov.in
India.gov.in|india gov,national portal|www.india.gov.in
USA.gov|usa gov|www.usa.gov
IRS|irs|www.irs.gov
GOV.UK|gov uk,uk government|www.gov.uk
DMV|dmv|www.dmv.org
CoWIN|cowin|www.cowin.gov.in
Election Commission of India|election commission,voter id|voters.eci.gov.in
NTA|nta,national testing agency|nta.ac.in
JEE Main|jee main,jee|jeemain.nta.nic.in
NEET|neet|neet.nta.nic.in
CBSE|cbse|www.cbse.gov.in
UPSC|upsc|upsc.gov.in
SSC|ssc,staff selection commission|ssc.gov.in
Common App|common app|www.commonapp.org
College Board|college board,sat|www.collegeboard.org
ETS GRE|gre,ets|www.ets.org/gre
IELTS|ielts|ielts.org
TOEFL|toefl|www.ets.org/toefl
BBC|bbc|www.bbc.com
BBC News|bbc news|www.bbc.com/news
CNN|cnn|www.cnn.com
Reuters|reuters|www.reuters.com
Associated Press|ap news,associated press|apnews.com
The New York Times|new york times,nyt,nytimes|www.nytimes.com
The Washington Post|washington post|www.washingtonpost.com
The Guardian|the guardian,guardian|www.theguardian.com
The Wall Street Journal|wall street journal,wsj|www.wsj.com
Financial Times|financial times,ft|www.ft.com
The Economist|the economist,economist|www.economist.com
Al Jazeera|al jazeera|www.aljazeera.com
NPR|npr|www.npr.org
Fox News|fox news|www.foxnews.com
NBC News|nbc news|www.nbcnews.com
ABC News|abc news|abcnews.go.com
CBS News|cbs news|www.cbsnews.com
USA Today|usa today|www.usatoday.com
Times of India|times of india,toi|timesofindia.indiatimes.com
The Hindu|the hindu,hindu|www.thehindu.com
Hindustan Times|hindustan times|www.hindustantimes.com
Indian Express|indian express|indianexpress.com
NDTV|ndtv|www.ndtv.com
India Today|india today|www.indiatoday.in
Mint News|livemint,mint news|www.livemint.com
News18|news18,news 18|www.news18.com
Aaj Tak|aaj tak,aajtak|www.aajtak.in
The Verge|the verge,verge|www.theverge.com
TechCrunch|techcrunch,tech crunch|techcrunch.com
Wired|wired|www.wired.com
Ars Technica|ars technica|arstechnica.com
Engadget|engadget|www.engadget.com
CNET|cnet|www.cnet.com
Tom's Hardware|toms hardware|www.tomshardware.com
AnandTech|anandtech|www.anandtech.com
Android Authority|android authority|www.androidauthority.com
9to5Mac|9to5mac,nine to five mac|9to5mac.com
GSMArena|gsmarena,gsm arena|www.gsmarena.com
XDA Developers|xda,xda developers|www.xda-developers.com
How-To Geek|how to geek,howtogeek|www.howtogeek.com
Lifehacker|lifehacker|lifehacker.com
Mashable|mashable|mashable.com
Gizmodo|gizmodo|gizmodo.com
Product Hunt|product hunt|www.producthunt.com
Slashdot|slashdot|slashdot.org
BuzzFeed|buzzfeed|www.buzzfeed.com
Vox|vox|www.vox.com
Politico|politico|www.politico.com
Axios|axios|www.axios.com
Weather.com|weather dot com,weather channel|weather.com
AccuWeather|accuweather,accu weather|www.accuweather.com
Windy|windy,windy weather|www.windy.com
Time and Date|time and date,timeanddate|www.timeanddate.com
ESPN|espn|www.espn.com
ESPNcricinfo|cricinfo,espn cricinfo,cricket scores|www.espncricinfo.com
Cricbuzz|cricbuzz,cric buzz|www.cricbuzz.com
BCCI|bcci|www.bcci.tv
IPL|ipl,indian premier league|www.iplt20.com
ICC|icc cricket|www.icc-cricket.com
FIFA|fifa|www.fifa.com
UEFA|uefa,champions league|www.uefa.com
Premier League|premier league,epl|www.premierleague.com
NBA|nba|www.nba.com
NFL|nfl|www.nfl.com
MLB|mlb|www.mlb.com
NHL|nhl|www.nhl.com
Formula 1|formula 1,f1,formula one|www.formula1.com
BBC Sport|bbc sport|www.bbc.com/sport
Sky Sports|sky sports|www.skysports.com
Goal.com|goal dot com|www.goal.com
OneFootball|onefootball,one football|onefootball.com
Olympics|olympics|www.olympics.com
Chess.com|chess,chess dot com|www.chess.com
Lichess|lichess|lichess.org
Steam Store|steam store,steam website|store.steampowered.com
Epic Games Store|epic games,epic games store|store.epicgames.com
GOG|gog|www.gog.com
itch.io|itch io,itch|itch.io
PlayStation|playstation,psn|www.playstation.com
Nintendo|nintendo|www.nintendo.com
Roblox|roblox|www.roblox.com
Minecraft|minecraft|www.minecraft.net
Fortnite|fortnite|www.fortnite.com
Valorant|valorant|playvalorant.com
League of Legends|league of legends,lol game|www.leagueoflegends.com
Riot Games|riot games,riot|www.riotgames.com
Battle.net|battle net,blizzard|battle.net
EA|ea,electronic arts,ea app|www.ea.com
Ubisoft|ubisoft|www.ubisoft.com
Rockstar Games|rockstar,rockstar games,gta|www.rockstargames.com
IGN|ign|www.ign.com
GameSpot|gamespot|www.gamespot.com
Polygon|polygon|www.polygon.com
PC Gamer|pc gamer|www.pcgamer.com
Metacritic|metacritic|www.metacritic.com
HowLongToBeat|how long to beat|howlongtobeat.com
Nexus Mods|nexus mods|www.nexusmods.com
SteamDB|steamdb,steam db|steamdb.info
ProtonDB|protondb|www.protondb.com
CurseForge|curseforge|www.curseforge.com
Speedtest|speedtest,speed test,internet speed test|www.speedtest.net
Fast.com|fast dot com|fast.com
Down Detector|downdetector,down detector,is it down|downdetector.com
Have I Been Pwned|have i been pwned,hibp|haveibeenpwned.com
VirusTotal|virustotal,virus total|www.virustotal.com
Proton Mail|proton mail,protonmail|mail.proton.me
Proton VPN|proton vpn|protonvpn.com
Bitwarden|bitwarden|vault.bitwarden.com
1Password|1password,one password|my.1password.com
LastPass|lastpass|lastpass.com
NordVPN|nordvpn,nord vpn|nordvpn.com
Dropbox|dropbox|www.dropbox.com
Box|box dot com|app.box.com
MEGA|mega,mega nz|mega.nz
WeTransfer|wetransfer,we transfer|wetransfer.com
iCloud|icloud,i cloud|www.icloud.com
Yahoo|yahoo|www.yahoo.com
Yahoo Mail|yahoo mail|mail.yahoo.com
DuckDuckGo|duckduckgo,duck duck go|duckduckgo.com
Brave Search|brave search|search.brave.com
Ecosia|ecosia|www.ecosia.org
Startpage|startpage|www.startpage.com
Yandex|yandex|yandex.com
Baidu|baidu|www.baidu.com
Apple|apple,apple website|www.apple.com
Samsung|samsung|www.samsung.com
Microsoft|microsoft,microsoft website|www.microsoft.com
Dell|dell|www.dell.com
HP|hp,hewlett packard|www.hp.com
Lenovo|lenovo|www.lenovo.com
ASUS|asus|www.asus.com
Acer|acer|www.acer.com
MSI|msi|www.msi.com
Razer|razer|www.razer.com
Logitech|logitech|www.logitech.com
NVIDIA|nvidia,nvidia drivers|www.nvidia.com
AMD|amd,amd drivers|www.amd.com
Intel|intel,intel drivers|www.intel.com
Corsair|corsair|www.corsair.com
OnePlus|oneplus,one plus|www.oneplus.com
Xiaomi|xiaomi,mi|www.mi.com
Realme|realme|www.realme.com
Vivo|vivo|www.vivo.com
Oppo|oppo|www.oppo.com
Google Store|google store,pixel store|store.google.com
Tesla|tesla|www.tesla.com
Spotify for Artists|spotify for artists|artists.spotify.com
Patreon|patreon|www.patreon.com
Ko-fi|ko fi,kofi|ko-fi.com
Buy Me a Coffee|buy me a coffee|www.buymeacoffee.com
Gumroad|gumroad|gumroad.com
Shopify|shopify|www.shopify.com
WordPress|wordpress,wordpress dot com|wordpress.com
Wix|wix|www.wix.com
Squarespace|squarespace|www.squarespace.com
Webflow|webflow|webflow.com
GoDaddy|godaddy,go daddy|www.godaddy.com
Namecheap|namecheap|www.namecheap.com
Hostinger|hostinger|www.hostinger.com
Mailchimp|mailchimp|mailchimp.com
HubSpot|hubspot|app.hubspot.com
Salesforce|salesforce|www.salesforce.com
Zendesk|zendesk|www.zendesk.com
Intercom|intercom|www.intercom.com
Calendly|calendly|calendly.com
Doodle|doodle poll|doodle.com
Typeform|typeform|www.typeform.com
SurveyMonkey|surveymonkey,survey monkey|www.surveymonkey.com
Loom|loom|www.loom.com
Zapier|zapier|zapier.com
IFTTT|ifttt|ifttt.com
Evernote|evernote|evernote.com
Obsidian|obsidian website|obsidian.md
Roam Research|roam research|roamresearch.com
Coda|coda|coda.io
Dropbox Paper|dropbox paper|paper.dropbox.com
Zoho|zoho|www.zoho.com
Zoho Mail|zoho mail|mail.zoho.com
Smallpdf|smallpdf,small pdf|smallpdf.com
iLovePDF|ilovepdf,i love pdf|www.ilovepdf.com
PDF24|pdf24|tools.pdf24.org
CloudConvert|cloudconvert,cloud convert|cloudconvert.com
Online Convert|online convert|www.online-convert.com
TinyPNG|tinypng,tiny png|tinypng.com
Squoosh|squoosh|squoosh.app
Regex101|regex101,regex tester|regex101.com
JSON Formatter|json formatter|jsonformatter.org
Can I Use|can i use,caniuse|caniuse.com
DevDocs|devdocs,dev docs|devdocs.io
Roadmap.sh|roadmap sh,developer roadmap|roadmap.sh
Exercism|exercism|exercism.org
Codewars|codewars|www.codewars.com
Project Euler|project euler|projecteuler.net
Advent of Code|advent of code|adventofcode.com
Frontend Mentor|frontend mentor|www.frontendmentor.io
Tailwind CSS|tailwind,tailwind css|tailwindcss.com
Bootstrap|bootstrap|getbootstrap.com
Material UI|material ui,mui|mui.com
shadcn/ui|shadcn,shadcn ui|ui.shadcn.com
Electron|electron docs,electronjs|www.electronjs.org
Flutter|flutter|flutter.dev
Android Developers|android developers,android docs|developer.android.com
Apple Developer|apple developer|developer.apple.com
Unity|unity,unity3d|unity.com
Unreal Engine|unreal engine,unreal|www.unrealengine.com
Godot|godot|godotengine.org
Blender|blender|www.blender.org
Sketchfab|sketchfab|sketchfab.com
ArtStation|artstation,art station|www.artstation.com
DeviantArt|deviantart,deviant art|www.deviantart.com
Pixiv|pixiv|www.pixiv.net
Flickr|flickr|www.flickr.com
500px|500px|500px.com
Imgur|imgur|imgur.com
Giphy|giphy|giphy.com
Tenor|tenor|tenor.com
Know Your Meme|know your meme|knowyourmeme.com
9GAG|9gag|9gag.com
WebMD|webmd,web md|www.webmd.com
Mayo Clinic|mayo clinic|www.mayoclinic.org
Healthline|healthline|www.healthline.com
NHS|nhs|www.nhs.uk
CDC|cdc|www.cdc.gov
WHO|who,world health organization|www.who.int
Practo|practo|www.practo.com
1mg|1mg,tata 1mg|www.1mg.com
PharmEasy|pharmeasy,pharm easy|pharmeasy.in
Apollo 24/7|apollo,apollo 247|www.apollo247.com
MyFitnessPal|myfitnesspal,my fitness pal|www.myfitnesspal.com
Strava|strava|www.strava.com
Fitbit|fitbit|www.fitbit.com
Headspace|headspace|www.headspace.com
Calm|calm app|www.calm.com
AllRecipes|allrecipes,all recipes|www.allrecipes.com
Food Network|food network|www.foodnetwork.com
BBC Good Food|bbc good food|www.bbcgoodfood.com
Tasty|tasty recipes|tasty.co
Serious Eats|serious eats|www.seriouseats.com
Yelp|yelp|www.yelp.com
OpenTable|opentable,open table|www.opentable.com
Eventbrite|eventbrite|www.eventbrite.com
Meetup|meetup|www.meetup.com
BookMyShow|bookmyshow,book my show|in.bookmyshow.com
Ticketmaster|ticketmaster|www.ticketmaster.com
District|paytm insider,district|www.district.in
Fandango|fandango|www.fandango.com
NASA|nasa|www.nasa.gov
ISRO|isro|www.isro.gov.in
SpaceX|spacex,space x|www.spacex.com
National Geographic|national geographic,nat geo|www.nationalgeographic.com
Smithsonian|smithsonian|www.si.edu
Britannica|britannica,encyclopedia britannica|www.britannica.com
TED|ted,ted talks|www.ted.com
Scientific American|scientific american|www.scientificamerican.com
Nature|nature journal|www.nature.com
arXiv|arxiv,archive papers|arxiv.org
PubMed|pubmed|pubmed.ncbi.nlm.nih.gov
ResearchGate|researchgate,research gate|www.researchgate.net
Semantic Scholar|semantic scholar|www.semanticscholar.org
JSTOR|jstor|www.jstor.org
Zotero|zotero|www.zotero.org
Mendeley|mendeley|www.mendeley.com
Our World in Data|our world in data|ourworldindata.org
Statista|statista|www.statista.com
Google Trends|google trends,trends|trends.google.com
Similarweb|similarweb|www.similarweb.com
Archive.today|archive today,archive ph|archive.ph
OpenStreetMap|openstreetmap,open street map|www.openstreetmap.org
Bing Maps|bing maps|www.bing.com/maps
Apple Maps|apple maps|maps.apple.com
What3words|what3words|what3words.com
Zoom Earth|zoom earth|zoom.earth
Speedrun.com|speedrun|www.speedrun.com
Fandom|fandom,wikia|www.fandom.com
TV Tropes|tv tropes|tvtropes.org
Wattpad|wattpad|www.wattpad.com
Archive of Our Own|ao3,archive of our own|archiveofourown.org
Webtoon|webtoon,webtoons|www.webtoons.com
Kindle Cloud Reader|kindle,kindle reader|read.amazon.com
Scribd|scribd|www.scribd.com
SlideShare|slideshare|www.slideshare.net
Prezi|prezi|prezi.com
Gamma|gamma app|gamma.app
Tome|tome app|tome.app
Pitch|pitch dot com|pitch.com
Mentimeter|mentimeter|www.mentimeter.com
Kahoot|kahoot|kahoot.it
Padlet|padlet|padlet.com
Google Jamboard|jamboard|jamboard.google.com
Microsoft Whiteboard|microsoft whiteboard|whiteboard.office.com
Clipchamp|clipchamp,clip champ|app.clipchamp.com
CapCut|capcut,cap cut|www.capcut.com
Kapwing|kapwing|www.kapwing.com
VEED|veed|www.veed.io
Descript|descript|www.descript.com
Otter.ai|otter ai,otter|otter.ai
Rev|rev transcription|www.rev.com
DeepL|deepl,deep l|www.deepl.com
Reverso|reverso|www.reverso.net
Linguee|linguee|www.linguee.com
Forvo|forvo,pronunciation|forvo.com
Typing Club|typing club,typingclub|www.typingclub.com
Monkeytype|monkeytype,monkey type,typing test|monkeytype.com
10FastFingers|10fastfingers,ten fast fingers|10fastfingers.com
Keybr|keybr|www.keybr.com
Lofi Girl|lofi girl,lofi radio|www.youtube.com/@LofiGirl
Radio Garden|radio garden|radio.garden
Noisli|noisli,background noise|www.noisli.com
Pomofocus|pomofocus,pomodoro timer|pomofocus.io
Rainy Mood|rainy mood,rain sounds|rainymood.com
Habitica|habitica|habitica.com
Forest|forest app|www.forestapp.cc
Google Takeout|google takeout,takeout|takeout.google.com
Google Password Manager|google passwords,password manager|passwords.google.com
Find My Device|find my device,find my phone|www.google.com/android/find
Apple Find My|find my iphone,find my|www.icloud.com/find
Gravatar|gravatar|gravatar.com
Linktree|linktree|linktr.ee
Bitly|bitly,bit ly|bitly.com
QR Code Generator|qr code generator,qr generator|www.qr-code-generator.com
Temp Mail|temp mail,temporary email|temp-mail.org
Random.org|random org|www.random.org
Calculator.net|calculator net,online calculator|www.calculator.net
Mathway|mathway|www.mathway.com
Photomath|photomath|photomath.com
Periodic Table|periodic table,ptable|ptable.com
PhET Simulations|phet,phet simulations|phet.colorado.edu
Scratch|scratch,scratch mit|scratch.mit.edu
Code.org|code org|code.org
Tinkercad|tinkercad|www.tinkercad.com
Thingiverse|thingiverse|www.thingiverse.com
Instructables|instructables|www.instructables.com
Arduino|arduino|www.arduino.cc
Raspberry Pi|raspberry pi|www.raspberrypi.com
Adafruit|adafruit|www.adafruit.com
SparkFun|sparkfun|www.sparkfun.com
Hackaday|hackaday|hackaday.com
iFixit|ifixit,i fix it|www.ifixit.com
PCPartPicker|pcpartpicker,pc part picker|pcpartpicker.com
UserBenchmark|userbenchmark|www.userbenchmark.com
Geekbench Browser|geekbench|browser.geekbench.com
PassMark|passmark,cpu benchmark|www.cpubenchmark.net
Ninite|ninite|ninite.com
Microsoft Store Web|microsoft store web,apps microsoft|apps.microsoft.com
Windows Update Catalog|update catalog|www.catalog.update.microsoft.com
Windows Insider|windows insider|www.microsoft.com/windowsinsider
Microsoft Support|microsoft support,windows help|support.microsoft.com
Google Support|google support,google help|support.google.com
Apple Support|apple support|support.apple.com
Amazon Orders|amazon orders,my orders|www.amazon.com/gp/css/order-history
Flipkart Orders|flipkart orders|www.flipkart.com/account/orders
`;

export interface Site { name: string; aliases: string[]; url: string }

export const SITES: Site[] = RAW.trim().split('\n').map((line) => {
  const [name, aliases, address] = line.split('|');
  return { name: name.trim(), aliases: aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean), url: `https://${address.trim()}` };
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const INDEX = new Map<string, Site>();
for (const s of SITES) {
  for (const key of [s.name, ...s.aliases]) {
    const k = norm(key);
    if (k && !INDEX.has(k)) INDEX.set(k, s);
  }
}

/** Finds a website by spoken name ("yt music", "the youtube music website"). */
export function findSite(query: string): Site | null {
  const q = norm(query).replace(/^(the|my) /, '').replace(/ (website|site|web app|webapp|page|online|dot com|com)$/, '').trim();
  return INDEX.get(q) ?? INDEX.get(q.replace(/ /g, '')) ?? null;
}

/** Sites with a search page: "search amazon for headphones", "play lofi on youtube". */
const SEARCH_RAW = `
YouTube|youtube,you tube,yt|https://www.youtube.com/results?search_query={q}
YouTube Music|youtube music,yt music,ytm|https://music.youtube.com/search?q={q}
Google|google|https://www.google.com/search?q={q}
Google Images|google images,images|https://www.google.com/search?tbm=isch&q={q}
Google Maps|google maps,maps|https://www.google.com/maps/search/{q}
Google News|google news,news|https://news.google.com/search?q={q}
Google Scholar|google scholar,scholar|https://scholar.google.com/scholar?q={q}
Google Drive|google drive,drive|https://drive.google.com/drive/search?q={q}
Gmail|gmail,my email,my mail|https://mail.google.com/mail/u/0/#search/{q}
Bing|bing|https://www.bing.com/search?q={q}
DuckDuckGo|duckduckgo,duck duck go|https://duckduckgo.com/?q={q}
Wikipedia|wikipedia,wiki|https://en.wikipedia.org/w/index.php?search={q}
Amazon|amazon|https://www.amazon.com/s?k={q}
Amazon India|amazon india|https://www.amazon.in/s?k={q}
Flipkart|flipkart|https://www.flipkart.com/search?q={q}
eBay|ebay|https://www.ebay.com/sch/i.html?_nkw={q}
Walmart|walmart|https://www.walmart.com/search?q={q}
Etsy|etsy|https://www.etsy.com/search?q={q}
AliExpress|aliexpress|https://www.aliexpress.com/wholesale?SearchText={q}
Myntra|myntra|https://www.myntra.com/{q}
GitHub|github|https://github.com/search?q={q}
Stack Overflow|stack overflow,stackoverflow|https://stackoverflow.com/search?q={q}
npm|npm|https://www.npmjs.com/search?q={q}
PyPI|pypi|https://pypi.org/search/?q={q}
MDN|mdn|https://developer.mozilla.org/en-US/search?q={q}
Reddit|reddit|https://www.reddit.com/search/?q={q}
X|twitter,x|https://x.com/search?q={q}
LinkedIn|linkedin|https://www.linkedin.com/search/results/all/?keywords={q}
Pinterest|pinterest|https://www.pinterest.com/search/pins/?q={q}
Instagram|instagram|https://www.instagram.com/explore/search/keyword/?q={q}
TikTok|tiktok|https://www.tiktok.com/search?q={q}
Spotify Web|spotify web,spotify website|https://open.spotify.com/search/{q}
SoundCloud|soundcloud|https://soundcloud.com/search?q={q}
JioSaavn|jiosaavn,saavn|https://www.jiosaavn.com/search/{q}
Genius|genius,lyrics|https://genius.com/search?q={q}
Netflix|netflix|https://www.netflix.com/search?q={q}
Prime Video|prime video|https://www.primevideo.com/search?phrase={q}
IMDb|imdb|https://www.imdb.com/find/?q={q}
Twitch|twitch|https://www.twitch.tv/search?term={q}
Vimeo|vimeo|https://vimeo.com/search?q={q}
Quora|quora|https://www.quora.com/search?q={q}
Medium|medium|https://medium.com/search?q={q}
Unsplash|unsplash|https://unsplash.com/s/photos/{q}
Pexels|pexels|https://www.pexels.com/search/{q}
Giphy|giphy,gifs|https://giphy.com/search/{q}
Steam|steam|https://store.steampowered.com/search/?term={q}
Epic Games|epic games|https://store.epicgames.com/browse?q={q}
Udemy|udemy|https://www.udemy.com/courses/search/?q={q}
Coursera|coursera|https://www.coursera.org/search?query={q}
Khan Academy|khan academy|https://www.khanacademy.org/search?page_search_query={q}
Wolfram Alpha|wolfram alpha,wolfram|https://www.wolframalpha.com/input?i={q}
Dictionary.com|dictionary|https://www.dictionary.com/browse/{q}
Thesaurus.com|thesaurus|https://www.thesaurus.com/browse/{q}
Urban Dictionary|urban dictionary|https://www.urbandictionary.com/define.php?term={q}
Google Translate|google translate,translate|https://translate.google.com/?sl=auto&tl=en&text={q}
Yelp|yelp|https://www.yelp.com/search?find_desc={q}
Tripadvisor|tripadvisor|https://www.tripadvisor.com/Search?q={q}
Booking.com|booking|https://www.booking.com/searchresults.html?ss={q}
Airbnb|airbnb|https://www.airbnb.com/s/{q}/homes
Indeed|indeed|https://www.indeed.com/jobs?q={q}
Naukri|naukri|https://www.naukri.com/{q}-jobs
Glassdoor|glassdoor|https://www.glassdoor.com/Search/results.htm?keyword={q}
arXiv|arxiv|https://arxiv.org/a/{q}
PubMed|pubmed|https://pubmed.ncbi.nlm.nih.gov/?term={q}
Hugging Face|hugging face|https://huggingface.co/search/full-text?q={q}
Perplexity|perplexity|https://www.perplexity.ai/search?q={q}
ChatGPT|chatgpt,chat gpt|https://chatgpt.com/?q={q}
Claude|claude|https://claude.ai/new?q={q}
`;

export interface SearchSite { name: string; aliases: string[]; template: string }

export const SEARCH_SITES: SearchSite[] = SEARCH_RAW.trim().split('\n').map((line) => {
  const [name, aliases, template] = line.split('|');
  return { name: name.trim(), aliases: aliases.split(',').map((a) => a.trim()), template: template.trim() };
});

const SEARCH_INDEX = new Map<string, SearchSite>();
for (const s of SEARCH_SITES) for (const k of [s.name, ...s.aliases]) { const n = norm(k); if (!SEARCH_INDEX.has(n)) SEARCH_INDEX.set(n, s); }

export function findSearchSite(name: string): SearchSite | null {
  const q = norm(name).replace(/^(the|my) /, '');
  return SEARCH_INDEX.get(q) ?? null;
}

export function searchSiteUrl(site: SearchSite, query: string): string {
  return site.template.replace('{q}', encodeURIComponent(query.trim().slice(0, 300)));
}
