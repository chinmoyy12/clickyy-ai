"""Test phrases for the recognition benchmark.

Each item: (lang, tts_text, keywords). `tts_text` is what the synthetic voice says.
`keywords` are the words the recognizer must not miss, written in romanized form;
Devanagari output is transliterated before matching (see score.py). Alternatives for
one keyword are separated by "|".
"""

EN = [
    ("open spotify", ["open", "spotify"]),
    ("set the volume to thirty percent", ["volume", "30|thirty", "percent|%"]),
    ("what's the weather in Mumbai today", ["weather", "mumbai", "today"]),
    ("remind me to call mom at 7 pm", ["remind", "call", "mom", "7|seven", "pm|p.m"]),
    ("take a screenshot", ["screenshot|screen shot"]),
    ("turn off Bluetooth", ["turn", "off", "bluetooth"]),
    ("search YouTube for lofi beats", ["search", "youtube", "lofi|lo-fi", "beats"]),
    ("put my laptop to sleep in thirty minutes", ["laptop", "sleep", "30|thirty", "minutes"]),
    ("create an Excel sheet for a monthly budget", ["excel", "sheet", "monthly", "budget"]),
    ("write a Python program for a weather app", ["write", "python", "program", "weather"]),
    ("check my CPU usage and core temperatures", ["cpu", "usage", "temperatures"]),
    ("close all Chrome windows", ["close", "chrome", "windows"]),
    ("move Visual Studio Code to my second monitor", ["visual studio code|vs code", "second", "monitor"]),
    ("find all PDF documents in my downloads folder", ["pdf", "downloads", "folder"]),
    ("add buy groceries to my to-do list", ["buy", "groceries", "to-do|todo|to do"]),
    ("draft an email to Rahul about the project deadline", ["email", "rahul", "project", "deadline"]),
    ("play Kesariya by Arijit Singh", ["play", "kesariya", "arijit", "singh"]),
    ("how many days until Diwali", ["days", "diwali"]),
    ("convert five hundred rupees to dollars", ["500|five hundred", "rupees", "dollars"]),
    ("set a timer for twenty five minutes", ["timer", "25|twenty five|twenty-five", "minutes"]),
    ("open WhatsApp and send a message to Priya", ["whatsapp", "message", "priya"]),
    ("lock my computer", ["lock", "computer"]),
    ("increase the brightness to eighty percent", ["brightness", "80|eighty", "percent|%"]),
    ("what's on my calendar for Friday", ["calendar", "friday"]),
    ("turn on dark mode", ["turn", "on", "dark", "mode"]),
    ("snap Notepad to the left half of the screen", ["snap", "notepad", "left", "screen"]),
    ("show me the largest files on my desktop", ["largest", "files", "desktop"]),
    ("pause the music after this song", ["pause", "music", "song"]),
    ("translate good morning into Hindi", ["translate", "good morning", "hindi"]),
    ("explain quantum computing like I'm a beginner", ["explain", "quantum", "computing", "beginner"]),
]

# Pure Hindi, spoken by the Hindi voices.
HI = [
    ("स्पॉटिफ़ाई खोलो", ["spotify|spotifai|spotiphai", "kholo"]),
    ("आवाज़ तीस प्रतिशत कर दो", ["awaz|aawaz|avaz|awaaz", "tis|tees|30", "pratishat|percent|%"]),
    ("आज मौसम कैसा है", ["aj|aaj", "mausam|mosam", "kaisa"]),
    ("मुझे शाम सात बजे माँ को फ़ोन करने की याद दिलाना", ["sham|shaam", "sat|saat|7", "baje", "ma|maa|man", "phon|fon|phone", "yad|yaad"]),
    ("स्क्रीनशॉट लो", ["skrinshot|screenshot|skrin shot", "lo"]),
    ("ब्लूटूथ बंद करो", ["blututh|bluetooth|blutooth", "band", "karo"]),
    ("यूट्यूब पर पुराने गाने चलाओ", ["yutyub|youtube|yutub", "purane", "gane|gaane", "chalao"]),
    ("लैपटॉप को तीस मिनट में स्लीप कर दो", ["laptop|laipatop|laiptop", "tis|tees|30", "minat|minute|mint", "slip|sleep"]),
    ("बजट के लिए एक्सेल शीट बनाओ", ["bajat|budget", "eksel|excel|aksel", "shit|sheet", "banao"]),
    ("मेरी बैटरी कितनी बची है", ["baitari|battery|bettery", "kitni|kitani", "bachi"]),
    ("दिवाली में कितने दिन बाकी हैं", ["divali|diwali", "kitne|kitane", "din", "baki|baaki"]),
    ("पच्चीस मिनट का टाइमर लगाओ", ["pachis|pachchis|25", "minat|minute|mint", "taimar|timer", "lagao"]),
    ("कंप्यूटर लॉक करो", ["kampyutar|computer|kampyuter", "lok|lock|laik", "karo"]),
    ("डार्क मोड चालू करो", ["dark|dark", "mod|mode", "chalu|chaalu", "karo"]),
    ("अगला गाना बजाओ", ["agla|agala", "gana|gaana", "bajao"]),
    ("गाना रोक दो", ["gana|gaana", "rok"]),
    ("अभी क्या समय हुआ है", ["abhi", "kya", "samay|samaya", "hua"]),
    ("डाउनलोड फ़ोल्डर खोलो", ["daunlod|download|daunload", "pholdar|folder|foldar", "kholo"]),
    ("राहुल को ईमेल लिखो", ["rahul", "imel|email|i mel", "likho"]),
    ("वाई फाई चालू करो", ["vai phai|wifi|wi-fi|wai fai|vaai phaai", "chalu|chaalu", "karo"]),
]

# Hinglish: Hindi grammar with English nouns, as people actually talk. Written in
# Devanagari so the Hindi voices pronounce it naturally.
HINGLISH = [
    ("क्रोम ओपन करो", ["krom|chrome", "opan|open", "karo"]),
    ("वॉल्यूम थोड़ा बढ़ा दो", ["volyum|volume|valyum", "thoda|thora", "badha|barha"]),
    ("नोटपैड में नया नोट बनाओ", ["notpaid|notepad|notpad", "naya", "not|note", "banao"]),
    ("कल सुबह नौ बजे मीटिंग का रिमाइंडर सेट करो", ["kal", "subah", "nau|9", "baje", "miting|meeting", "rimaindar|reminder", "set|sait"]),
    ("सीपीयू यूसेज चेक करो", ["sipiyu|cpu|si pi yu", "yusej|usage", "chek|check"]),
    ("मेरा लैपटॉप स्लो क्यों चल रहा है", ["laptop|laipatop|laiptop", "slo|slow", "kyon|kyun|kyu"]),
    ("डेस्कटॉप पर सारी पीडीएफ फाइलें ढूंढो", ["desktop|deskatop|desktap", "pidief|pdf|pi di ef", "phailen|files|failen", "dhundho|dhoondho"]),
    ("अरिजीत सिंह के गाने प्ले करो", ["arijit|arijeet", "singh|sinh|sing", "gane|gaane", "ple|play"]),
    ("इंटरनेट स्पीड टेस्ट करो", ["intarnet|internet", "spid|speed", "test"]),
    ("ब्राइटनेस कम करो", ["braitnes|brightness", "kam", "karo"]),
    ("व्हाट्सएप पर प्रिया को मैसेज भेजो", ["whatsapp|vhatsaep|watsapp", "priya", "maisej|message|mesej", "bhejo"]),
    ("पाइथन में एक कैलकुलेटर प्रोग्राम लिखो", ["paithan|python", "kailkuletar|calculator|kalkuletar", "program|prograam", "likho"]),
    ("सिस्टम रीस्टार्ट मत करना", ["sistam|system", "ristart|restart", "mat"]),
    ("ज़ूम मीटिंग जॉइन करो", ["zum|zoom|jum", "miting|meeting", "join|jvain|joyin"]),
    ("बैकग्राउंड ऐप्स बंद कर दो", ["baikgraund|background", "aips|apps|aps|eps", "band"]),
]

WAKE_POSITIVE = [
    "Clicky", "Hey Clicky", "Okay Clicky", "Clicky, open Spotify", "Hey Clicky, what's the time",
    "Clicky, set the volume to thirty percent", "Hi Clicky", "Clicky?", "Hey Clicky!",
]
WAKE_POSITIVE_HI = ["क्लिकी", "हे क्लिकी", "क्लिकी, गाना चलाओ", "ओके क्लिकी"]

# Sound-alikes and everyday speech that must NOT wake it.
WAKE_NEGATIVE = [
    "quickly", "click", "click here", "tricky", "sticky", "picky", "lucky", "cookie", "Vicky", "Nicky",
    "Ricky", "clicking the button", "it was a tricky question", "the floor is sticky", "I clicked the link",
    "come here quickly", "a lucky guess", "Mickey Mouse", "chocolate chip cookie", "hey Siri", "okay Google",
    "Alexa, play music", "hey Jarvis", "clique", "click it", "licking", "kick it", "pick me", "the weather is nice today",
    "let's meet tomorrow at noon", "please send me the report", "I'm going to the market", "turn left at the signal",
]
WAKE_NEGATIVE_HI = ["जल्दी करो", "क्या हाल है", "किताब लाओ", "चिकनी सड़क", "लकी नंबर", "मैं बाज़ार जा रहा हूँ", "कल मिलते हैं", "खिड़की खोलो"]

# Background talk for false-alarm rate per hour (spoken continuously, no wake word).
BACKGROUND = [
    "So I was thinking we could try the new restaurant near the station this weekend.",
    "The quarterly numbers look better than expected, but marketing spend went up quite a bit.",
    "Can you click on the second link and tell me what it says about the delivery date?",
    "My cousin is getting married in December, so we will travel to Guwahati for a week.",
    "That was a tricky bug. The cookie was being cleared every time the page reloaded.",
    "Quickly grab your jacket, it looks like it's going to rain in a few minutes.",
    "The kids are watching cartoons, Mickey and his friends are building a clubhouse.",
    "He was lucky to catch the last train, it left just seconds after he got on.",
    "Remember to water the plants and lock the back door before you leave tonight.",
    "I clicked the button twice by mistake and now there are two orders on my account.",
]
BACKGROUND_HI = [
    "आज ऑफिस में बहुत काम था, इसलिए मैं थोड़ा देर से घर पहुँचा।",
    "कल हम सब बाज़ार जाएँगे और दिवाली के लिए नए कपड़े खरीदेंगे।",
    "उसने जल्दी जल्दी खाना खाया और फिर क्रिकेट खेलने चला गया।",
    "बारिश की वजह से सड़क पर बहुत ट्रैफिक था और बस भी लेट थी।",
]
