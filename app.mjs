import { actions, departments, trainings, topics, knowledgeSource, permissionSource } from './catalog.mjs';

const $ = (id) => document.getElementById(id);
const storageKey = 'nurse-scope-profile-v1';
const emptyProfile = { department: '', trainings: [], custom: [] };
const profileDialog = $('profile-dialog');
const detailDialog = $('detail-dialog');
const controls = ['query', 'type', 'department-filter', 'training-filter'];
const types = { nursing: 'פעולת סיעוד', exceptional: 'פעולה חריגה' };
let profile = readProfile();
let draftCustom = [];
let mode = 'search';
let topic = '';
let enterPersonalView = false;

function normalize(value) {
  return value.toLocaleLowerCase('he').replace(/[\u0591-\u05c7]/g, '')
    .replace(/[׳״'"]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function readProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Object.hasOwn(departments, saved.department)) {
      return {
        department: saved.department,
        trainings: Array.isArray(saved.trainings) ? saved.trainings.filter((key) => Object.hasOwn(trainings, key) && key !== 'rn') : [],
        custom: Array.isArray(saved.custom) ? saved.custom.filter((item) => typeof item === 'string') : [],
      };
    }
  } catch {
    return emptyProfile;
  }
  return emptyProfile;
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function populateSelect(select, labels) {
  for (const [value, label] of Object.entries(labels)) {
    select.add(new Option(label, value));
  }
}

function fitsProfile(action) {
  return Boolean(profile.department)
    && (!action.departments || action.departments.includes(profile.department))
    && (action.requirements ?? []).every((group) => group.some((key) => profile.trainings.includes(key)));
}

function statusFor(action) {
  if (action.pending) return 'נדרש בירור · מיפוי התנאים טרם הושלם';
  if (!profile.department) return 'בדקי התאמה · בחרי מחלקה והכשרות';
  if (action.departments && !action.departments.includes(profile.department)) return 'המחלקה שנבחרה אינה כלולה במתאר של כרטיס זה';
  if (!fitsProfile(action)) return 'נדרשת הכשרה נוספת לפי הפרופיל שנבחר';
  if (action.type === 'exceptional') return 'נדרשת הרשאה אישית ליחידה';
  return 'בסמכותך לפי הפרופיל · בכפוף לתנאים ולאישורים';
}

function renderTopics() {
  const container = $('topics');
  container.replaceChildren();
  for (const [key, label] of [['', 'כל הנושאים'], ...Object.entries(topics).map(([id, item]) => [id, item.label])]) {
    const button = element('button', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(key === topic));
    button.addEventListener('click', () => {
      topic = key;
      for (const sibling of container.children) sibling.setAttribute('aria-pressed', String(sibling === button));
      renderResults();
    });
    container.append(button);
  }
}

function settingFor(action) {
  return action.setting || action.departments?.map((key) => departments[key]).join(', ')
    || 'יש לבדוק את המתאר בנוסח הרשמי.';
}

function qualificationsFor(action) {
  return [
    trainings.rn,
    ...(action.requirements ?? []).map((group) => group.map((key) => trainings[key]).join(' או ')),
  ].join(' + ');
}

function filteredActions() {
  const queryWords = normalize($('query').value).split(' ').filter(Boolean);
  const type = $('type').value;
  const department = $('department-filter').value;
  const training = $('training-filter').value;
  return actions.filter((action) => {
    if (mode === 'personal' && (action.pending || !fitsProfile(action))) return false;
    if (topic && action.topic !== topic) return false;
    if (type && action.type !== type) return false;
    if (department && !action.departments?.includes(department) && !action.allHospitalDepartments) return false;
    if (training === 'rn' && (action.requirements ?? []).some((group) => group.some((key) => !['ecmo', 'trach', 'catheter', 'nihss'].includes(key)))) return false;
    if (training && training !== 'rn' && !action.requirements?.flat().includes(training)) return false;
    const haystack = normalize([
      action.title, action.keywords, action.summary, topics[action.topic].label, qualificationsFor(action),
      settingFor(action), types[action.type], ...action.sources.map((source) => source.number),
    ].join(' '));
    return queryWords.every((word) => haystack.includes(word));
  });
}

function renderResults() {
  const results = $('results');
  results.replaceChildren();
  const filtered = filteredActions();
  $('count').textContent = filtered.length === 1 ? 'פעולה אחת' : `${filtered.length} פעולות`;
  $('reset').hidden = !topic && controls.every((id) => !$(id).value);

  for (const action of filtered) {
    const card = $('card-template').content.cloneNode(true);
    const category = topics[action.topic];
    card.querySelector('.card').dataset.color = category.color;
    card.querySelector('.category-mark').textContent = category.symbol;
    const badge = card.querySelector('.type');
    badge.textContent = types[action.type];
    badge.classList.toggle('exceptional', action.type === 'exceptional');
    card.querySelector('h3').textContent = action.title;
    card.querySelector('.summary').textContent = action.summary;
    card.querySelector('.card-meta').textContent = action.pending ? 'הפניה למקור · נדרש בירור' : category.label;
    const button = card.querySelector('button');
    button.setAttribute('aria-label', `לפרטי הפעולה: ${action.title}`);
    button.addEventListener('click', () => showAction(action));
    results.append(card);
  }

  if (!filtered.length) {
    const empty = element('div', '', 'empty');
    empty.append(element('p', mode === 'personal'
      ? 'במבחר הפעולות הנוכחי לא נמצאו כרטיסים תואמים לפרופיל ולסינון.'
      : 'לא נמצאו פעולות שמתאימות לחיפוש ולסינון.'));
    const link = element('a', 'פתיחת חוזר הריכוז המלא ↗');
    link.href = 'https://www.gov.il/he/pages/nd263-2026';
    link.target = '_blank';
    link.rel = 'noopener';
    empty.append(link);
    results.append(empty);
  }
}

function refreshMode() {
  const isPersonal = mode === 'personal';
  $('my-mode').setAttribute('aria-pressed', String(isPersonal));
  $('search-mode').setAttribute('aria-pressed', String(!isPersonal));
  $('catalog-title').textContent = isPersonal ? 'הסמכויות שלי' : 'מאגר הפעולות';
  $('profile-summary').textContent = profile.department
    ? `המחלקה שלי: ${departments[profile.department]} · ${trainings.rn}${profile.trainings.length ? ` + ${profile.trainings.length} הכשרות` : ''}`
    : 'חיפוש פתוח לפי פעולה, הכשרה ומחלקה';
  renderResults();
}

function resetFilters() {
  for (const id of controls) $(id).value = '';
  topic = '';
  renderTopics();
}

function switchMode(next) {
  if (mode !== next) resetFilters();
  mode = next;
  refreshMode();
  $(next === 'search' ? 'query' : 'catalog').focus();
}

function definition(list, label, value) {
  const group = element('div');
  group.append(element('dt', label), element('dd', value));
  list.append(group);
}

function sourceLinks(sources) {
  const list = element('ul');
  for (const source of sources) {
    const item = element('li');
    const link = element('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener';
    const number = element('bdi', source.number);
    link.append('פתיחת הנוסח הרשמי · ', number, ` · ${source.location} ↗`);
    item.append(link);
    list.append(item);
  }
  return list;
}

function showAction(action) {
  const detail = $('detail');
  const heading = element('div', '', 'dialog-head');
  const title = element('h2', action.title);
  title.id = 'detail-title';
  const close = element('button', '×', 'close');
  close.type = 'button';
  close.setAttribute('aria-label', 'סגירה');
  close.addEventListener('click', () => detailDialog.close());
  heading.append(title, close);
  const status = element('p', statusFor(action), 'detail-state');
  status.classList.toggle('match', !action.pending && action.type === 'nursing' && fitsProfile(action));
  const info = element('dl', '', 'detail-info');
  definition(info, 'סוג פעולה', types[action.type]);
  definition(info, action.pending ? 'הכשרה לפי ריכוז הפעולות' : 'הכשרה נדרשת', qualificationsFor(action));
  definition(info, 'מחלקה או מתאר', settingFor(action));
  detail.replaceChildren(heading, status, element('p', action.summary, 'detail-description'), info);

  detail.append(element('h3', 'תנאים וסייגים'));
  if (action.pending) {
    detail.append(element('p', 'הכרטיס כולל הפניה בחוזר הריכוז. יש לברר את ההכשרה, התנאים והסייגים במקור ובמחלקה לפני הביצוע.'));
  } else {
    const conditions = element('ul');
    for (const [reference, condition] of action.conditions) {
      const item = element('li', condition);
      item.append(' (', element('bdi', reference), ')');
      conditions.append(item);
    }
    detail.append(conditions);
  }
  if (action.type === 'exceptional') {
    detail.append(element('p', 'נדרשת הרשאה אישית ושמית מאת מנהל המרכז הרפואי או מי מטעמו, בחתימת המנהל הרפואי ובהסכמת מנהלת האחיות והאחות המבצעת. ההרשאה חלה רק ביחידה ובתנאים שבהם ניתנה.'));
  }
  detail.append(
    element('h3', 'אישור במחלקה'),
    element('p', 'לפני ביצוע, יש לוודא מול האחות האחראית במחלקה שהתקבל האישור הנדרש.'),
    element('h3', 'מקורות רשמיים'),
    sourceLinks([...action.sources, ...(action.type === 'exceptional' ? [permissionSource] : []), knowledgeSource]),
  );
  detailDialog.showModal();
  close.focus();
}

function renderCustom() {
  const list = $('custom-list');
  list.replaceChildren();
  for (const [index, name] of draftCustom.entries()) {
    const item = element('li', name);
    const button = element('button', 'הסרה', 'text-button');
    button.type = 'button';
    button.setAttribute('aria-label', `הסרת ההכשרה ${name}`);
    button.addEventListener('click', () => {
      draftCustom.splice(index, 1);
      renderCustom();
      $('custom-training').focus();
    });
    item.append(button);
    list.append(item);
  }
}

function showProfile(forPersonal = false) {
  enterPersonalView = forPersonal;
  $('profile-department').value = profile.department;
  $('custom-training').value = '';
  $('profile-error').hidden = true;
  draftCustom = [...profile.custom];
  for (const checkbox of $('profile-trainings').querySelectorAll('input')) {
    checkbox.checked = profile.trainings.includes(checkbox.value);
  }
  renderCustom();
  profileDialog.showModal();
}

function addCustomTraining() {
  const input = $('custom-training');
  const name = input.value.trim();
  if (!name) return true;
  const normalizedName = normalize(name);
  if (!normalizedName) {
    $('profile-error').textContent = 'יש להזין שם הכשרה.';
    $('profile-error').hidden = false;
    return false;
  }
  const known = Object.keys(trainings).find((key) => normalize(trainings[key]) === normalizedName);
  if (known && known !== 'rn') {
    $('profile-trainings').querySelector(`[value="${known}"]`).checked = true;
  } else if (!known && !draftCustom.some((value) => normalize(value) === normalizedName)) {
    draftCustom.push(name);
  }
  input.value = '';
  $('profile-error').hidden = true;
  renderCustom();
  input.focus();
  return true;
}

populateSelect($('profile-department'), departments);
populateSelect($('department-filter'), departments);
populateSelect($('training-filter'), trainings);
for (const [value, label] of Object.entries(trainings)) {
  if (value === 'rn') continue;
  const wrapper = element('label');
  const input = element('input');
  input.type = 'checkbox';
  input.value = value;
  wrapper.append(input, document.createTextNode(label));
  $('profile-trainings').append(wrapper);
}

for (const id of controls) $(id).addEventListener(id === 'query' ? 'input' : 'change', renderResults);
for (const button of document.querySelectorAll('[data-profile]')) button.addEventListener('click', () => showProfile());
for (const button of profileDialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => profileDialog.close());
$('search-mode').addEventListener('click', () => switchMode('search'));
$('my-mode').addEventListener('click', () => profile.department ? switchMode('personal') : showProfile(true));
$('reset').addEventListener('click', () => {
  resetFilters();
  renderResults();
  $('query').focus();
});
$('add-training').addEventListener('click', addCustomTraining);
$('custom-training').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addCustomTraining();
  }
});
$('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!addCustomTraining()) return;
  const next = {
    department: $('profile-department').value,
    trainings: [...$('profile-trainings').querySelectorAll('input:checked')].map((checkbox) => checkbox.value),
    custom: [...draftCustom],
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    $('profile-error').textContent = 'הדפדפן לא אפשר לשמור את הפרופיל. בדקי שהאחסון המקומי זמין.';
    $('profile-error').hidden = false;
    return;
  }
  profile = next;
  profileDialog.close();
  if (enterPersonalView) switchMode('personal');
  else refreshMode();
});

renderTopics();
refreshMode();
