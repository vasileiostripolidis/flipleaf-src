// Interface text. English is the default; Greek is used when the system language is Greek.
const en = {
  mFile: "File", mEdit: "Edit", mView: "View", mTools: "Tools", mHelp: "Help",
  openFile2: "Open…", openRecent: "Open recent", noRecent: "No recent files", closeDoc: "Close document", exit: "Exit",
  copy: "Copy", showSidebar: "Sidebar",
  editPdf: "Edit text & images|Ctrl+E", editShort: "Edit PDF", editTitle: "Edit PDF",
  editAddText: "Add text", editAddImage: "Add image", editReplace: "Replace image", editDelete: "Delete (Del)",
  editHint: "Click any text or image to select it. Double-click text to retype it.",
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
  findOf: "{n} of {total}", findNone: "No results", findMany: "More than {total}",
  tagline: "A feather-light, private PDF reader", openFile: "Open a PDF",
  dropHere: "or drag a file anywhere in this window", recent: "Recent files",
  dropHint: "Drop the PDF to open it",
  saveAs: "Save as…", rotateCw: "Rotate clockwise", rotateCcw: "Rotate counterclockwise",
  pageDisplay: "Page display", singlePage: "Single page", continuous: "Single page, scrolling",
  twoPage: "Two pages", twoPageScroll: "Two pages, scrolling", presentation: "Full screen",
  readAloud: "Read this page aloud", nightMode: "Night reading", properties: "Document properties",
  shortcuts: "Keyboard shortcuts", about: "About Flipleaf", reading: "Reading aloud…",
  thumbnails: "Pages", bookmarks: "Bookmarks", noBookmarks: "This document has no bookmarks.",
  done: "Done", color: "Color", thickness: "Thickness", fontSize: "Size",
  hlHighlight: "Highlight", hlInk: "Draw", hlText: "Text box", hlStamp: "Image",
  hintHighlight: "Select text to highlight it, or drag freely over the page.",
  hintInk: "Draw on the page with the mouse, pen or finger.",
  hintText: "Click where you want the text to appear.",
  hintStamp: "Click on the page to place an image, then drag to move or resize it.",
  unsaved: "Unsaved changes", saved: "Saved", savedTo: "Saved to {path}", saveFailed: "Could not save: {err}",
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
  mFile: "Αρχείο", mEdit: "Επεξεργασία", mView: "Προβολή", mTools: "Εργαλεία", mHelp: "Βοήθεια",
  openFile2: "Άνοιγμα…", openRecent: "Πρόσφατα αρχεία", noRecent: "Δεν υπάρχουν πρόσφατα αρχεία", closeDoc: "Κλείσιμο εγγράφου", exit: "Έξοδος",
  copy: "Αντιγραφή", showSidebar: "Πλαϊνή στήλη",
  editPdf: "Επεξεργασία κειμένου & εικόνων|Ctrl+E", editShort: "Επεξεργασία PDF", editTitle: "Επεξεργασία PDF",
  editAddText: "Προσθήκη κειμένου", editAddImage: "Προσθήκη εικόνας", editReplace: "Αντικατάσταση εικόνας", editDelete: "Διαγραφή (Del)",
  editHint: "Κάνε κλικ σε κείμενο ή εικόνα για να το επιλέξεις. Διπλό κλικ σε κείμενο για να το ξαναγράψεις.",
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
  findOf: "{n} από {total}", findNone: "Δεν βρέθηκε", findMany: "Περισσότερα από {total}",
  tagline: "Ελαφρύς και ιδιωτικός αναγνώστης PDF", openFile: "Άνοιγμα PDF",
  dropHere: "ή σύρε ένα αρχείο οπουδήποτε στο παράθυρο", recent: "Πρόσφατα αρχεία",
  dropHint: "Άφησε το PDF για να ανοίξει",
  saveAs: "Αποθήκευση ως…", rotateCw: "Περιστροφή δεξιόστροφα", rotateCcw: "Περιστροφή αριστερόστροφα",
  pageDisplay: "Προβολή σελίδων", singlePage: "Μία σελίδα", continuous: "Μία σελίδα, συνεχής κύλιση",
  twoPage: "Δύο σελίδες", twoPageScroll: "Δύο σελίδες, συνεχής κύλιση", presentation: "Πλήρης οθόνη",
  readAloud: "Ανάγνωση σελίδας φωναχτά", nightMode: "Νυχτερινή ανάγνωση", properties: "Ιδιότητες εγγράφου",
  shortcuts: "Συντομεύσεις πληκτρολογίου", about: "Σχετικά με το Flipleaf", reading: "Ανάγνωση…",
  thumbnails: "Σελίδες", bookmarks: "Σελιδοδείκτες", noBookmarks: "Το έγγραφο δεν έχει σελιδοδείκτες.",
  done: "Τέλος", color: "Χρώμα", thickness: "Πάχος", fontSize: "Μέγεθος",
  hlHighlight: "Επισήμανση", hlInk: "Σχεδίαση", hlText: "Πλαίσιο κειμένου", hlStamp: "Εικόνα",
  hintHighlight: "Επίλεξε κείμενο για να το επισημάνεις ή σύρε ελεύθερα πάνω στη σελίδα.",
  hintInk: "Σχεδίασε στη σελίδα με ποντίκι, γραφίδα ή δάχτυλο.",
  hintText: "Κάνε κλικ εκεί που θέλεις να μπει το κείμενο.",
  hintStamp: "Κάνε κλικ στη σελίδα για να βάλεις εικόνα και σύρε τη για να τη μετακινήσεις ή να αλλάξεις μέγεθος.",
  unsaved: "Μη αποθηκευμένες αλλαγές", saved: "Αποθηκεύτηκε", savedTo: "Αποθηκεύτηκε: {path}", saveFailed: "Η αποθήκευση απέτυχε: {err}",
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

export const LANG = (navigator.languages || [navigator.language]).some((l) => /^el\b/i.test(l)) ? "el" : "en";
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
