// Interface text. English is the default; Greek is used when the system language is Greek.
const en = {
  closeTab: "Close tab", newTab: "Open another PDF", closeOthers: "Close other tabs", kTabs: "Next / previous tab",
  closeAllTitle: "Close all tabs?", closeAllBody: "You have {n} documents open. Closing Flipleaf closes all of them.", closeAll: "Close all",
  dontAskAgain: "Don't ask me again", askCloseAll: "Ask before closing several tabs",
  mFile: "File", mEdit: "Edit", mView: "View", mTools: "Tools", mHelp: "Help",
  openFile2: "Open…", openRecent: "Open recent", noRecent: "No recent files", closeDoc: "Close document", exit: "Exit",
  copy: "Copy", showSidebar: "Sidebar",
  editPdf: "Edit text & images|Ctrl+E", editShort: "Edit PDF", editTitle: "Edit PDF",
  editAddText: "Add text", editAddImage: "Add image", editReplace: "Replace image", editDelete: "Delete (Del)", editDeletePage: "Delete page", editDeletePageN: "Delete page {n}", editDeletePageHint: "Delete the page you are looking at", editPageDeleted: "Page {n} deleted. Undo (Ctrl+Z) brings it back.", editLastPage: "A PDF needs at least one page.", editCloseGap: "Close the gap", editGapHide: "Hide", editSpace: "Space", editSpaceLess: "−{n} pt (leaves {left} pt)", editBreak: "Page break", editBreakHint: "Start a new page: what comes after the point you click continues at the top of the next page", editHintBreak: "Click between two lines: what comes after continues on the next page · Esc to cancel", editBreakHere: "Click: new page from here", editBreakNoSpot: "Click between two lines of text (not above the first one).", editBreakDone: "Page break added: the text continues on page {n}. Undo (Ctrl+Z) removes it.", editSpaceHint: "Make the space between two lines as big or as small as you want; text moves on to (or up from) the next pages", editHintSpace: "Point between two lines: drag down for more space, up for less · a click adds one empty line · Esc to cancel", editSpaceHere: "Drag down for more, up for less", editSpaceAmount: "+{n} pt", editSpaceNoSpot: "Point between two lines of text.", editSpaceAdded: "Space added. Undo (Ctrl+Z) removes it.", editSpaceAddedPages: "Space added; the text continues on {n} new page(s) at the end. Undo (Ctrl+Z) removes it.", editShape: "Shape", editShape_line: "Line", editShape_arrow: "Arrow", editShape_rect: "Rectangle", editShape_fill: "Filled rectangle", editShape_ellipse: "Ellipse", editStroke: "Line thickness", editHintDraw: "Drag on the page to draw · Shift: straight lines, squares and circles · Esc to cancel", editHintShape: "Drag to move · drag the corner to resize · change the colour or thickness from the bar · Del to delete", editGapNothing: "Nothing here to move up: this space is already as small as it can be.", editCloseGapHint: "Move the content below (and from the next pages) up into this empty space. Tip: drag over any empty space to close it; Shift+Del deletes and closes the gap.", editGapClosed: "Gap closed. Undo (Ctrl+Z) puts everything back.", editGapClosedPage: "Gap closed; the empty last page was removed. Undo (Ctrl+Z) puts everything back.", editGapClosedPages: "Gap closed; {n} empty page(s) at the end removed. Undo (Ctrl+Z) puts everything back.",
  editHint: "Click text or an image to select it; drag over an empty spot (or Shift+click) to select several. Double-click text to retype it.",
  editHintMany: "{n} selected. Del deletes them, Shift+Del deletes them and closes the gap. Drag to move them.",
  editGapNone: "There is no empty line to close: delete whole lines (drag over them to select them all).",
  editHintAdd: "Click on the page where the new text should start.",
  editHintPlace: "Click on the page where it should go. Esc cancels.",
  editHintText: "Double-click or press Enter to edit · drag to move · Del to delete",
  editHintImage: "Drag to move · drag the corner to resize · Del to delete",
  editImageFailed: "That image could not be added.", editLoading: "Preparing the document for editing…",
  licenseTitle: "License agreement", licenseIntro: "Please read the Flipleaf license agreement. You must accept it to use Flipleaf.",
  accept: "I accept", decline: "Decline", licenses: "License & third-party notices",
  open: "Open file|Ctrl+O", save: "Save|Ctrl+S", print: "Print|Ctrl+P",
  sidebar: "Page thumbnails & bookmarks|F4",
  toolSelect: "Select text|V", toolHand: "Hand tool|H", toolHighlight: "Highlight text", toolDraw: "Draw",
  toolText: "Add text box", toolImage: "Add image", toolSign: "Fill & Sign", undo: "Undo|Ctrl+Z", redo: "Redo|Ctrl+Y",
  prev: "Previous page|←", next: "Next page|→", zoomOut: "Zoom out|Ctrl+−", zoomIn: "Zoom in|Ctrl++",
  zAuto: "Automatic", zActual: "Actual size", zFit: "Fit page", zWidth: "Fit width",
  find: "Find|Ctrl+F", findPrev: "Previous match|Shift+Enter", findNext: "Next match|Enter", close: "Close|Esc",
  findPlaceholder: "Find in document", highlightAll: "Highlight all", matchCase: "Match case",
  wholeWords: "Whole words", matchDiacritics: "Match accents",
  findOf: "{n} of {total}", findNone: "No results", findPages: "on {n} pages", findReading: "Reading the text… {p}%", findMore: "and {n} more (Enter goes through all of them)", pageN: "Page {n}", findMany: "More than {total}",
  tagline: "A feather-light, private PDF reader", openFile: "Open a PDF", scanShort: "Scan from photo",
  settings: "Settings…", settingsTitle: "Settings", setCompress: "Reduce file size", setCompressRename: "Save the result as a new file (the original stays as it is)", setSuffix: "Added to the name",
  setExample: "Example: {name}", setPhotos: "Photos", setPhotoInsert: "When inserting a photo", setAsk: "Ask each time", setLook: "Appearance", setApp: "Application",
  setSaved: "Settings saved.", setExampleDoc: "Document",
  imgScanTitle: "Insert photo", imgScanBody: "Insert it as it is, or scan it first: Flipleaf straightens the page and whitens the paper, like a scanner.",
  imgAsIs: "Insert as it is", imgScan: "Scan first", rememberChoice: "Remember my choice", askImageScan: "Offer to scan photos when inserting them",
  dropHere: "or drag a file anywhere in this window", recent: "Recent files",
  dropHint: "Drop the PDF to open it",
  saveAs: "Save as…", rotateCw: "Rotate clockwise", rotateCcw: "Rotate counterclockwise",
  pageDisplay: "Page display", singlePage: "Single page", continuous: "Single page, scrolling",
  twoPage: "Two pages", twoPageScroll: "Two pages, scrolling", presentation: "Full screen",
  readAloud: "Read this page aloud", nightMode: "Night reading", language: "Language", langSystem: "Same as system", langReload: "The window will reload to change the language. Documents that are not saved to a file will close.", langSaveFirst: "Save your changes first, then change the language.", checkUpdates: "Check for updates…", autoUpdates: "Check for updates automatically", upTitle: "Update available", upBody: "Flipleaf {v} is available. You have {cur}.", upNotes: "What's new", upInstall: "Update now", upDownload: "Download", upLater: "Later", upSkip: "Skip this version", upLatest: "You have the latest version ({v}).", upError: "Couldn't check for updates. Check your internet connection.", upDownloading: "Downloading update… {p}", upRestart: "Installing the update… Flipleaf will restart.", upFailed: "The update could not be installed: {e}", upSaveFirst: "Save your changes first, then update.", upWeb: "The web version always runs the latest version.", theme: "Theme", themeSystem: "Same as system", themeLight: "Light", themeDark: "Dark", themeToDark: "Dark theme", themeToLight: "Light theme", properties: "Document properties",
  shortcuts: "Keyboard shortcuts", about: "About Flipleaf", reading: "Reading aloud…",
  thumbnails: "Pages", bookmarks: "Bookmarks", noBookmarks: "This document has no bookmarks.",
  done: "Done", color: "Color", thickness: "Thickness", fontSize: "Size",
  hlHighlight: "Highlight", hlInk: "Draw", hlText: "Text box", hlStamp: "Image",
  hintHighlight: "Select text to highlight it, or drag freely over the page.",
  hintInk: "Draw on the page with the mouse, pen or finger.",
  hintText: "Click where you want the text to appear.",
  hintStamp: "Click on the page to place an image, then drag to move or resize it.",
  unsaved: "Unsaved changes", saved: "Saved", upDone: "Update complete. You now have Flipleaf {v}.", saveFailed: "Could not save: {err}",
  discardTitle: "Save changes?", discardBody: "“{name}” has changes that haven't been saved.",
  discard: "Don't save", cancel: "Cancel", saveAndContinue: "Save", ok: "OK",
  passwordTitle: "Password required", passwordBody: "“{name}” is protected. Enter its password to open it.",
  passwordWrong: "That password is not correct. Try again.", password: "Password",
  invalid: "This file is not a valid PDF, or it is damaged.", failed: "Could not open the file: {err}",
  notPdf: "That doesn't look like a PDF file.",
  pFile: "File name", pSize: "File size", pTitle: "Title", pAuthor: "Author", pSubject: "Subject",
  pKeywords: "Keywords", pCreated: "Created", pModified: "Modified", pCreator: "Application",
  pProducer: "PDF producer", pVersion: "PDF version", pPages: "Pages", pPageSize: "Page size",
  printing: "Preparing to print…", printPage: "Page {n} of {total}", noSpeech: "Read aloud is not available on this system.",
  noText: "This page has no readable text.", forms: "This document has a form you can fill in.",
  aboutBody: "Flipleaf {v} — a feather-light, private PDF reader.\n\nYour files never leave your computer. No accounts, no tracking.\n\nEngines: Mozilla PDF.js (Apache-2.0) and PDFium (BSD). Icons: Lucide (ISC). Fonts: Liberation-derived (OFL).",
  kOpen: "Open a file", kSave: "Save", kSaveAs: "Save as", kPrint: "Print", kFind: "Find", kSidebar: "Show/hide sidebar",
  kZoom: "Zoom in / out", kActual: "Actual size", kFitPage: "Fit page", kFitWidth: "Fit width",
  kRotate: "Rotate pages", kPresent: "Full screen", kNav: "Next / previous page", kFirstLast: "First / last page",
  kSelect: "Select tool", kHand: "Hand tool", kUndo: "Undo / redo", kNight: "Night reading",
  kProps: "Document properties", kRead: "Read aloud", kHelp: "This list", kEdit: "Edit text & images", kClose: "Close document",
};

const el = {
  closeTab: "Κλείσιμο καρτέλας", newTab: "Άνοιγμα κι άλλου PDF", closeOthers: "Κλείσιμο των άλλων καρτελών", kTabs: "Επόμενη / προηγούμενη καρτέλα",
  closeAllTitle: "Κλείσιμο όλων των καρτελών;", closeAllBody: "Έχεις {n} ανοιχτά έγγραφα. Αν κλείσεις το Flipleaf, θα κλείσουν όλα.", closeAll: "Κλείσιμο όλων",
  dontAskAgain: "Να μην ερωτηθώ ξανά", askCloseAll: "Ερώτηση πριν κλείσουν πολλές καρτέλες",
  mFile: "Αρχείο", mEdit: "Επεξεργασία", mView: "Προβολή", mTools: "Εργαλεία", mHelp: "Βοήθεια",
  openFile2: "Άνοιγμα…", openRecent: "Πρόσφατα αρχεία", noRecent: "Δεν υπάρχουν πρόσφατα αρχεία", closeDoc: "Κλείσιμο εγγράφου", exit: "Έξοδος",
  copy: "Αντιγραφή", showSidebar: "Πλαϊνή στήλη",
  editPdf: "Επεξεργασία κειμένου & εικόνων|Ctrl+E", editShort: "Επεξεργασία PDF", editTitle: "Επεξεργασία PDF",
  editAddText: "Προσθήκη κειμένου", editAddImage: "Προσθήκη εικόνας", editReplace: "Αντικατάσταση εικόνας", editDelete: "Διαγραφή (Del)", editDeletePage: "Διαγραφή σελίδας", editDeletePageN: "Διαγραφή της σελίδας {n}", editDeletePageHint: "Διαγραφή της σελίδας που βλέπεις", editPageDeleted: "Η σελίδα {n} διαγράφηκε. Με Αναίρεση (Ctrl+Z) επιστρέφει.", editLastPage: "Ένα PDF χρειάζεται τουλάχιστον μία σελίδα.", editCloseGap: "Κλείσιμο κενού", editGapHide: "Απόκρυψη", editSpace: "Κενό", editSpaceLess: "−{n} pt (μένουν {left} pt)", editBreak: "Αλλαγή σελίδας", editBreakHint: "Αλλαγή σελίδας: ό,τι ακολουθεί από το σημείο που θα πατήσεις συνεχίζει στην αρχή της επόμενης σελίδας", editHintBreak: "Κλικ ανάμεσα σε δύο γραμμές: ό,τι ακολουθεί συνεχίζει στην επόμενη σελίδα · Esc για ακύρωση", editBreakHere: "Κλικ: νέα σελίδα από εδώ", editBreakNoSpot: "Κάνε κλικ ανάμεσα σε δύο γραμμές κειμένου (όχι πάνω από την πρώτη).", editBreakDone: "Μπήκε αλλαγή σελίδας: το κείμενο συνεχίζει στη σελίδα {n}. Με Αναίρεση (Ctrl+Z) αφαιρείται.", editSpaceHint: "Κάνε το κενό ανάμεσα σε δύο γραμμές όσο μεγάλο ή μικρό θέλεις· το κείμενο πηγαίνει στις επόμενες σελίδες ή ανεβαίνει από αυτές", editHintSpace: "Δείξε ανάμεσα σε δύο γραμμές: σύρε κάτω για περισσότερο κενό, πάνω για λιγότερο · κλικ: μία κενή γραμμή · Esc για ακύρωση", editSpaceHere: "Σύρε κάτω για περισσότερο, πάνω για λιγότερο", editSpaceAmount: "+{n} pt", editSpaceNoSpot: "Δείξε ανάμεσα σε δύο γραμμές κειμένου.", editSpaceAdded: "Προστέθηκε κενό. Με Αναίρεση (Ctrl+Z) αφαιρείται.", editSpaceAddedPages: "Προστέθηκε κενό· το κείμενο συνεχίζει σε {n} νέα σελίδα/ες στο τέλος. Με Αναίρεση (Ctrl+Z) αφαιρείται.", editShape: "Σχήμα", editShape_line: "Γραμμή", editShape_arrow: "Βέλος", editShape_rect: "Ορθογώνιο", editShape_fill: "Γεμάτο ορθογώνιο", editShape_ellipse: "Έλλειψη", editStroke: "Πάχος γραμμής", editHintDraw: "Σύρε πάνω στη σελίδα για να σχεδιάσεις · Shift: ίσιες γραμμές, τετράγωνα και κύκλοι · Esc για ακύρωση", editHintShape: "Σύρε για μετακίνηση · σύρε τη γωνία για αλλαγή μεγέθους · άλλαξε χρώμα ή πάχος από τη μπάρα · Del για διαγραφή", editGapNothing: "Δεν υπάρχει κάτι να ανέβει εδώ: το κενό είναι ήδη όσο μικρό γίνεται.", editCloseGapHint: "Ανεβάζει σε αυτό το κενό ό,τι είναι από κάτω και από τις επόμενες σελίδες. Συμβουλή: σύρε πάνω από οποιοδήποτε κενό για να το κλείσεις· Shift+Del: διαγραφή και κλείσιμο κενού.", editGapClosed: "Το κενό έκλεισε. Με Αναίρεση (Ctrl+Z) επιστρέφουν όλα όπως ήταν.", editGapClosedPage: "Το κενό έκλεισε· η τελευταία σελίδα άδειασε και αφαιρέθηκε. Με Αναίρεση (Ctrl+Z) επιστρέφουν όλα.", editGapClosedPages: "Το κενό έκλεισε· αφαιρέθηκαν {n} κενές σελίδες στο τέλος. Με Αναίρεση (Ctrl+Z) επιστρέφουν όλα.",
  editHint: "Κλικ σε κείμενο ή εικόνα για επιλογή· σύρε πάνω από κενό σημείο (ή Shift+κλικ) για να επιλέξεις πολλά. Διπλό κλικ σε κείμενο για να το ξαναγράψεις.",
  editHintMany: "Επιλεγμένα: {n}. Del: διαγραφή, Shift+Del: διαγραφή και κλείσιμο κενού. Σύρε για να τα μετακινήσεις.",
  editGapNone: "Δεν υπάρχει άδεια γραμμή για να κλείσει: διάγραψε ολόκληρες γραμμές (σύρε από πάνω τους για να τις επιλέξεις όλες).",
  editHintAdd: "Κάνε κλικ στη σελίδα εκεί που θα ξεκινά το νέο κείμενο.",
  editHintPlace: "Κάνε κλικ στη σελίδα εκεί που θα μπει. Esc για ακύρωση.",
  editHintText: "Διπλό κλικ ή Enter για αλλαγή · σύρε για μετακίνηση · Del για διαγραφή",
  editHintImage: "Σύρε για μετακίνηση · σύρε τη γωνία για αλλαγή μεγέθους · Del για διαγραφή",
  editImageFailed: "Η εικόνα δεν μπόρεσε να προστεθεί.", editLoading: "Προετοιμασία του εγγράφου για επεξεργασία…",
  licenseTitle: "Άδεια χρήσης", licenseIntro: "Διάβασε την άδεια χρήσης του Flipleaf. Για να χρησιμοποιήσεις το Flipleaf πρέπει να την αποδεχτείς.",
  accept: "Αποδέχομαι", decline: "Απόρριψη", licenses: "Άδεια χρήσης & λογισμικό τρίτων",
  open: "Άνοιγμα αρχείου|Ctrl+O", save: "Αποθήκευση|Ctrl+S", print: "Εκτύπωση|Ctrl+P",
  sidebar: "Μικρογραφίες σελίδων & σελιδοδείκτες|F4",
  toolSelect: "Επιλογή κειμένου|V", toolHand: "Εργαλείο χεριού|H", toolHighlight: "Επισήμανση κειμένου", toolDraw: "Σχεδίαση",
  toolText: "Προσθήκη πλαισίου κειμένου", toolImage: "Προσθήκη εικόνας", toolSign: "Συμπλήρωση & υπογραφή",
  undo: "Αναίρεση|Ctrl+Z", redo: "Ακύρωση αναίρεσης|Ctrl+Y",
  prev: "Προηγούμενη σελίδα|←", next: "Επόμενη σελίδα|→", zoomOut: "Σμίκρυνση|Ctrl+−", zoomIn: "Μεγέθυνση|Ctrl++",
  zAuto: "Αυτόματο", zActual: "Πραγματικό μέγεθος", zFit: "Ολόκληρη σελίδα", zWidth: "Πλάτος σελίδας",
  find: "Αναζήτηση|Ctrl+F", findPrev: "Προηγούμενο|Shift+Enter", findNext: "Επόμενο|Enter", close: "Κλείσιμο|Esc",
  findPlaceholder: "Αναζήτηση στο έγγραφο", highlightAll: "Επισήμανση όλων", matchCase: "Πεζά/κεφαλαία",
  wholeWords: "Ολόκληρες λέξεις", matchDiacritics: "Με τόνους",
  findOf: "{n} από {total}", findNone: "Δεν βρέθηκε", findPages: "σε {n} σελίδες", findReading: "Διαβάζει το κείμενο… {p}%", findMore: "και άλλα {n} (με Enter τα περνάς όλα)", pageN: "Σελίδα {n}", findMany: "Περισσότερα από {total}",
  tagline: "Ελαφρύς και ιδιωτικός αναγνώστης PDF", openFile: "Άνοιγμα PDF", scanShort: "Σάρωση από φωτογραφία",
  settings: "Ρυθμίσεις…", settingsTitle: "Ρυθμίσεις", setCompress: "Μείωση μεγέθους", setCompressRename: "Αποθήκευση του αποτελέσματος ως νέο αρχείο (το αρχικό μένει όπως είναι)", setSuffix: "Προσθήκη στο όνομα",
  setExample: "Παράδειγμα: {name}", setPhotos: "Φωτογραφίες", setPhotoInsert: "Κατά την εισαγωγή φωτογραφίας", setAsk: "Ερώτηση κάθε φορά", setLook: "Εμφάνιση", setApp: "Εφαρμογή",
  setSaved: "Οι ρυθμίσεις αποθηκεύτηκαν.", setExampleDoc: "Έγγραφο",
  imgScanTitle: "Εισαγωγή φωτογραφίας", imgScanBody: "Να μπει όπως είναι ή να περάσει πρώτα από σάρωση; Με τη σάρωση το Flipleaf ισιώνει τη σελίδα και ασπρίζει το χαρτί, σαν σαρωτής.",
  imgAsIs: "Όπως είναι", imgScan: "Σάρωση πρώτα", rememberChoice: "Να θυμάσαι την επιλογή μου", askImageScan: "Πρόταση σάρωσης κατά την εισαγωγή φωτογραφίας",
  dropHere: "ή σύρε ένα αρχείο οπουδήποτε στο παράθυρο", recent: "Πρόσφατα αρχεία",
  dropHint: "Άφησε το PDF για να ανοίξει",
  saveAs: "Αποθήκευση ως…", rotateCw: "Περιστροφή δεξιόστροφα", rotateCcw: "Περιστροφή αριστερόστροφα",
  pageDisplay: "Προβολή σελίδων", singlePage: "Μία σελίδα", continuous: "Μία σελίδα, συνεχής κύλιση",
  twoPage: "Δύο σελίδες", twoPageScroll: "Δύο σελίδες, συνεχής κύλιση", presentation: "Πλήρης οθόνη",
  readAloud: "Ανάγνωση σελίδας φωναχτά", nightMode: "Νυχτερινή ανάγνωση", language: "Γλώσσα", langSystem: "Όπως το σύστημα", langReload: "Το παράθυρο θα ανανεωθεί για να αλλάξει η γλώσσα. Όσα έγγραφα δεν είναι αποθηκευμένα σε αρχείο θα κλείσουν.", langSaveFirst: "Αποθήκευσε πρώτα τις αλλαγές σου και μετά άλλαξε τη γλώσσα.", checkUpdates: "Έλεγχος για ενημερώσεις…", autoUpdates: "Αυτόματος έλεγχος για ενημερώσεις", upTitle: "Διαθέσιμη ενημέρωση", upBody: "Το Flipleaf {v} είναι διαθέσιμο. Έχεις την {cur}.", upNotes: "Τι νέο υπάρχει", upInstall: "Ενημέρωση τώρα", upDownload: "Λήψη", upLater: "Αργότερα", upSkip: "Παράλειψη αυτής της έκδοσης", upLatest: "Έχεις την τελευταία έκδοση ({v}).", upError: "Δεν ήταν δυνατός ο έλεγχος για ενημερώσεις. Έλεγξε τη σύνδεσή σου στο internet.", upDownloading: "Λήψη ενημέρωσης… {p}", upRestart: "Εγκατάσταση ενημέρωσης… Το Flipleaf θα ξεκινήσει ξανά.", upFailed: "Η ενημέρωση δεν εγκαταστάθηκε: {e}", upSaveFirst: "Αποθήκευσε πρώτα τις αλλαγές σου και μετά κάνε την ενημέρωση.", upWeb: "Η έκδοση web τρέχει πάντα την τελευταία έκδοση.", theme: "Θέμα", themeSystem: "Όπως το σύστημα", themeLight: "Φωτεινό", themeDark: "Σκούρο", themeToDark: "Σκούρο θέμα", themeToLight: "Φωτεινό θέμα", properties: "Ιδιότητες εγγράφου",
  shortcuts: "Συντομεύσεις πληκτρολογίου", about: "Σχετικά με το Flipleaf", reading: "Ανάγνωση…",
  thumbnails: "Σελίδες", bookmarks: "Σελιδοδείκτες", noBookmarks: "Το έγγραφο δεν έχει σελιδοδείκτες.",
  done: "Τέλος", color: "Χρώμα", thickness: "Πάχος", fontSize: "Μέγεθος",
  hlHighlight: "Επισήμανση", hlInk: "Σχεδίαση", hlText: "Πλαίσιο κειμένου", hlStamp: "Εικόνα",
  hintHighlight: "Επίλεξε κείμενο για να το επισημάνεις ή σύρε ελεύθερα πάνω στη σελίδα.",
  hintInk: "Σχεδίασε στη σελίδα με ποντίκι, γραφίδα ή δάχτυλο.",
  hintText: "Κάνε κλικ εκεί που θέλεις να μπει το κείμενο.",
  hintStamp: "Κάνε κλικ στη σελίδα για να βάλεις εικόνα και σύρε τη για να τη μετακινήσεις ή να αλλάξεις μέγεθος.",
  unsaved: "Μη αποθηκευμένες αλλαγές", saved: "Αποθηκεύτηκε", upDone: "Η ενημέρωση ολοκληρώθηκε. Τώρα έχεις το Flipleaf {v}.", saveFailed: "Η αποθήκευση απέτυχε: {err}",
  discardTitle: "Αποθήκευση αλλαγών;", discardBody: "Το «{name}» έχει αλλαγές που δεν έχουν αποθηκευτεί.",
  discard: "Χωρίς αποθήκευση", cancel: "Άκυρο", saveAndContinue: "Αποθήκευση", ok: "OK",
  passwordTitle: "Απαιτείται κωδικός", passwordBody: "Το «{name}» προστατεύεται. Γράψε τον κωδικό για να ανοίξει.",
  passwordWrong: "Ο κωδικός δεν είναι σωστός. Δοκίμασε ξανά.", password: "Κωδικός",
  invalid: "Το αρχείο δεν είναι έγκυρο PDF ή είναι κατεστραμμένο.", failed: "Δεν άνοιξε το αρχείο: {err}",
  notPdf: "Αυτό δεν μοιάζει με αρχείο PDF.",
  pFile: "Όνομα αρχείου", pSize: "Μέγεθος", pTitle: "Τίτλος", pAuthor: "Συντάκτης", pSubject: "Θέμα",
  pKeywords: "Λέξεις-κλειδιά", pCreated: "Δημιουργία", pModified: "Τροποποίηση", pCreator: "Εφαρμογή",
  pProducer: "Παραγωγός PDF", pVersion: "Έκδοση PDF", pPages: "Σελίδες", pPageSize: "Μέγεθος σελίδας",
  printing: "Προετοιμασία εκτύπωσης…", printPage: "Σελίδα {n} από {total}", noSpeech: "Η ανάγνωση φωναχτά δεν υποστηρίζεται σε αυτό το σύστημα.",
  noText: "Η σελίδα δεν έχει κείμενο για ανάγνωση.", forms: "Το έγγραφο έχει φόρμα που μπορείς να συμπληρώσεις.",
  aboutBody: "Flipleaf {v}: ελαφρύς και ιδιωτικός αναγνώστης PDF.\n\nΤα αρχεία σου δεν φεύγουν ποτέ από τον υπολογιστή. Χωρίς λογαριασμούς, χωρίς παρακολούθηση.\n\nΜηχανές: Mozilla PDF.js (Apache-2.0) και PDFium (BSD). Εικονίδια: Lucide (ISC). Γραμματοσειρές: από Liberation (OFL).",
  kOpen: "Άνοιγμα αρχείου", kSave: "Αποθήκευση", kSaveAs: "Αποθήκευση ως", kPrint: "Εκτύπωση", kFind: "Αναζήτηση", kSidebar: "Εμφάνιση/απόκρυψη πλαϊνής στήλης",
  kZoom: "Μεγέθυνση / σμίκρυνση", kActual: "Πραγματικό μέγεθος", kFitPage: "Ολόκληρη σελίδα", kFitWidth: "Πλάτος σελίδας",
  kRotate: "Περιστροφή σελίδων", kPresent: "Πλήρης οθόνη", kNav: "Επόμενη / προηγούμενη σελίδα", kFirstLast: "Πρώτη / τελευταία σελίδα",
  kSelect: "Επιλογή κειμένου", kHand: "Εργαλείο χεριού", kUndo: "Αναίρεση / ακύρωση αναίρεσης", kNight: "Νυχτερινή ανάγνωση",
  kProps: "Ιδιότητες εγγράφου", kRead: "Ανάγνωση φωναχτά", kHelp: "Αυτή η λίστα", kEdit: "Επεξεργασία κειμένου & εικόνων", kClose: "Κλείσιμο εγγράφου",
};

/** Lets feature modules register their own strings. */
export function addStrings(enStrings, elStrings) { Object.assign(en, enStrings); Object.assign(el, elStrings); }

/** Interface language: the user's choice (View → Language), otherwise the system language. */
const chosen = (() => { try { return JSON.parse(localStorage.getItem("flipleaf.lang")); } catch { return null; } })();
export const LANG = chosen === "el" || chosen === "en" ? chosen
  : (navigator.languages || [navigator.language]).some((l) => /^el\b/i.test(l)) ? "el" : "en";
document.documentElement.lang = LANG;
const dict = LANG === "el" ? el : en;

/** Translated text; `{name}` placeholders are filled from `vars`. Shortcut hints after "|" are dropped. */
export function t(key, vars) {
  let s = (dict[key] ?? en[key] ?? key).split("|")[0];
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  return s;
}
/** Keyboard shortcut attached to a string ("Save|Ctrl+S" → "Ctrl+S"). */
export function shortcut(key) {
  const s = dict[key] ?? en[key] ?? "";
  const k = s.split("|")[1] || "";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? k.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧") : k;
}

export function translateDom(root = document) {
  document.documentElement.lang = LANG;
  for (const n of root.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
  for (const n of root.querySelectorAll("[data-tip]")) n.setAttribute("aria-label", t(n.dataset.tip));
}
