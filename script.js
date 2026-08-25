const DATABASES = {
  place: "places.json",
  culture: "culture.json",
  food: "food.json",
  adventure: "adventure.json"
};

const TYPE_COLORS = {
  place: "#3478F6", culture: "#AF52DE", food: "#FF3B30", adventure: "#FF9500",
  geology: "#A66A32", nature: "#34C759", beach: "#32ADE6", hotel: "#5856D6"
};

const PRIORITY_META = {
  "must-see": { label: "Imperdibile", icon: "🔥", score: 4 },
  "very-interesting": { label: "Molto interessante", icon: "⭐", score: 3 },
  "local-gem": { label: "Locale particolare", icon: "💎", score: 2 },
  "nearby-detour": { label: "Deviazione se sei vicino", icon: "↪️", score: 1 }
};

function getDataPath(filename) {
  return window.location.pathname.includes("/pages/") ? `../data/${filename}` : `data/${filename}`;
}

async function loadJSON(filename) {
  try {
    const response = await fetch(getDataPath(filename));
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    return Object.values(data).find(Array.isArray) || [];
  } catch (error) {
    console.error("Errore caricando", filename, error);
    return [];
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function canonicalPriorityLevel(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  const aliases = {
    "must-see": "must-see", "must": "must-see", "imperdibile": "must-see",
    "very-interesting": "very-interesting", "interesting": "very-interesting", "molto-interessante": "very-interesting",
    "local-gem": "local-gem", "local": "local-gem", "locale-particolare": "local-gem",
    "nearby-detour": "nearby-detour", "detour": "nearby-detour", "se-sei-vicino": "nearby-detour", "deviazione-se-sei-vicino": "nearby-detour"
  };
  return aliases[v] || null;
}

function normalizePriority(rawPriority, tags = []) {
  let level = null;
  if (rawPriority && typeof rawPriority === "object") {
    level = canonicalPriorityLevel(rawPriority.level || rawPriority.label);
  } else {
    level = canonicalPriorityLevel(rawPriority);
  }

  if (!level) {
    const normalizedTags = (Array.isArray(tags) ? tags : []).map(x => String(x).toLowerCase());
    level = normalizedTags.includes("imperdibile") || normalizedTags.includes("must-see")
      ? "must-see"
      : "very-interesting";
  }

  const meta = PRIORITY_META[level];
  return {
    level,
    label: rawPriority?.label || meta.label,
    score: rawPriority?.score ?? meta.score,
    icon: meta.icon
  };
}


function normalizeLocality(item, tags = []) {
  const explicit = item.locality ?? item.localness ?? item.local_level ?? item.very_local;
  let veryLocal = false;

  if (explicit === true) {
    veryLocal = true;
  } else if (explicit && typeof explicit === "object") {
    const level = String(explicit.level || explicit.label || "").toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
    veryLocal = level === "very-local" || level === "posto-very-local" || explicit.very_local === true;
  } else if (typeof explicit === "string") {
    const level = explicit.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
    veryLocal = level === "very-local" || level === "posto-very-local";
  }

  const normalizedTags = (Array.isArray(tags) ? tags : []).map(x => String(x).toLowerCase().replaceAll("_", "-"));
  if (normalizedTags.includes("very-local") || normalizedTags.includes("posto-very-local")) {
    veryLocal = true;
  }

  // Compatibilità con i dati già presenti: se non abbiamo ancora
  // marcato esplicitamente un posto, consideriamo "very local"
  // le esperienze con local_score massimo e basso livello turistico.
  if (!veryLocal) {
    const exp = item.experience || {};
    if (Number(exp.local_score) >= 5 && Number(exp.touristic_score) <= 2) {
      veryLocal = true;
    }
  }

  return {
    veryLocal,
    level: veryLocal ? "very-local" : "standard",
    label: veryLocal ? "Posto very local" : ""
  };
}

function normalizeItem(item, defaultType = "place") {
  const coordinates = item.coordinates || {};
  let categories = [];
  if (Array.isArray(item.categories)) categories = item.categories;
  else if (item.category) categories = [item.category];
  else if (item.categoria) categories = [item.categoria];
  categories = categories.map(x => String(x).toLowerCase());
  const tags = Array.isArray(item.tags) ? item.tags : [];

  return {
    raw: item,
    id: item.id || "",
    type: item.type || defaultType,
    name: item.name || item.nome || "Senza nome",
    area: item.area || item.zone || item.zona || "",
    description: item.description || item.descrizione || "",
    whyGo: item.why_go || "",
    history: item.history || "",
    provider: item.provider || "",
    foodType: item.food_type || "",
    latitude: coordinates.lat ?? coordinates.latitude ?? item.lat ?? item.latitude,
    longitude: coordinates.lon ?? coordinates.lng ?? coordinates.longitude ?? item.lon ?? item.lng ?? item.longitude,
    categories,
    tags,
    priority: normalizePriority(item.priority, tags),
    locality: normalizeLocality(item, tags),
    interest: item.interest || {},
    practical: item.practical || {},
    geology: item.geology || {},
    links: item.links || {},
    reviews: item.reviews || {},
    conditions: item.conditions || {},
    photography: item.photography || {},
    experience: item.experience || {},
    restaurant: item.restaurant || null,
    activityOptions: item.activity_options || [],
    mustTry: item.must_try || [],
    placesNearby: item.places_nearby || [],
    foodNearby: item.food_nearby || [],
    activities: item.activities || [],
    notes: item.notes || ""
  };
}

function hideSection(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function yesNo(value) {
  if (value === true) return "Sì";
  if (value === false) return "No";
  return null;
}

function formatCurrency(value, currency = "MUR") {
  if (value === null || value === undefined || value === "") return null;
  if (Number(value) === 0) return "Gratis";
  if (currency === "MUR") return `Rs ${value}`;
  if (currency === "EUR") return `€ ${value}`;
  return `${value} ${currency}`;
}

function starString(value) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value))));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function getRatingData(reviews) {
  if (!reviews) return null;
  if (typeof reviews.rating === "number") {
    return { rating: `${reviews.rating}/${reviews.scale || 5}`, count: reviews.review_count || null, source: reviews.source || "" };
  }
  if (Array.isArray(reviews.ratings) && reviews.ratings.length) {
    const first = reviews.ratings[0];
    return { rating: `${first.rating}/${first.scale || 5}`, count: first.review_count || null, source: first.source || "" };
  }
  return null;
}

function getMarkerColor(item, databaseType) {
  const c = item.categories;
  if (c.includes("hotel")) return TYPE_COLORS.hotel;
  if (databaseType === "food" || ["food", "ristorante", "street-food", "mercato"].some(x => c.includes(x))) return TYPE_COLORS.food;
  if (databaseType === "adventure" || ["avventura", "trekking", "zipline", "quad"].some(x => c.includes(x))) return TYPE_COLORS.adventure;
  if (["spiaggia", "mare", "beach"].some(x => c.includes(x))) return TYPE_COLORS.beach;
  if (databaseType === "culture" || ["cultura", "religione", "tempio", "museo", "unesco", "moschea", "pagoda", "chiesa"].some(x => c.includes(x))) return TYPE_COLORS.culture;
  if (["geologia", "geomorfologia", "geosito", "vulcanismo"].some(x => c.includes(x))) return TYPE_COLORS.geology;
  if (["natura", "cascata", "foresta", "parco"].some(x => c.includes(x))) return TYPE_COLORS.nature;
  return TYPE_COLORS[databaseType] || TYPE_COLORS.place;
}

function matchesCategoryFilter(selectedType, marker) {
  if (selectedType === "all") return true;
  const type = marker.travelExplorerType;
  const c = marker.travelExplorerCategories || [];
  if (selectedType === "place") return type === "place";
  if (selectedType === "beach") return ["spiaggia", "mare", "beach", "laguna"].some(x => c.includes(x));
  if (selectedType === "nature") return ["natura", "cascata", "foresta", "parco", "laguna", "riserva"].some(x => c.includes(x));
  if (selectedType === "culture") return type === "culture" || ["cultura", "storia", "religione", "unesco", "museo", "tempio", "moschea", "pagoda", "chiesa"].some(x => c.includes(x));
  if (selectedType === "geology") return ["geologia", "geomorfologia", "vulcanismo", "geosito", "cratere"].some(x => c.includes(x));
  if (selectedType === "food") return type === "food" || ["food", "ristorante", "street-food", "mercato", "bar", "cafe", "bakery", "rum", "te"].some(x => c.includes(x));
  if (selectedType === "adventure") return type === "adventure" || ["avventura", "trekking", "sport", "snorkeling", "kayak", "zipline", "quad", "diving", "surf", "canyoning", "catamarano"].some(x => c.includes(x));
  return true;
}

function matchesPriorityFilter(selectedPriority, marker) {
  return selectedPriority === "all" || marker.travelExplorerPriority === selectedPriority;
}

function matchesLocalityFilter(selectedLocality, marker) {
  if (selectedLocality === "all") return true;
  if (selectedLocality === "very-local") return marker.travelExplorerVeryLocal === true;
  return true;
}

function createAdvancedMapFilters() {
  const filterContainer = document.querySelector(".map-filters");
  if (!filterContainer || document.getElementById("priority-filter-row")) return;

  const existingButtons = Array.from(filterContainer.querySelectorAll(".filter-button"));

  const typeRow = document.createElement("div");
  typeRow.className = "travel-filter-row";
  const typeLabel = document.createElement("span");
  typeLabel.className = "travel-filter-label";
  typeLabel.textContent = "TIPO";
  typeRow.appendChild(typeLabel);

  existingButtons.forEach(button => {
    button.dataset.filterGroup = "category";
    typeRow.appendChild(button);
  });

  const priorityRow = document.createElement("div");
  priorityRow.id = "priority-filter-row";
  priorityRow.className = "travel-filter-row priority-row";
  const priorityLabel = document.createElement("span");
  priorityLabel.className = "travel-filter-label";
  priorityLabel.textContent = "PRIORITÀ";
  priorityRow.appendChild(priorityLabel);

  [
    ["all", "Tutte"],
    ["must-see", "🔥 Imperdibile"],
    ["very-interesting", "⭐ Molto interessante"],
    ["local-gem", "💎 Locale particolare"],
    ["nearby-detour", "↪️ Se sei vicino"]
  ].forEach(([value, label], index) => {
    const button = document.createElement("button");
    button.className = "filter-button priority-filter" + (index === 0 ? " active" : "");
    button.dataset.filterGroup = "priority";
    button.dataset.filter = value;
    button.textContent = label;
    priorityRow.appendChild(button);
  });

  const localityRow = document.createElement("div");
  localityRow.id = "locality-filter-row";
  localityRow.className = "travel-filter-row locality-row";
  const localityLabel = document.createElement("span");
  localityLabel.className = "travel-filter-label";
  localityLabel.textContent = "STILE";
  localityRow.appendChild(localityLabel);

  [
    ["all", "Tutti"],
    ["very-local", "🏘️ Posto very local"]
  ].forEach(([value, label], index) => {
    const button = document.createElement("button");
    button.className = "filter-button locality-filter" + (index === 0 ? " active" : "");
    button.dataset.filterGroup = "locality";
    button.dataset.filter = value;
    button.textContent = label;
    localityRow.appendChild(button);
  });

  filterContainer.innerHTML = "";
  filterContainer.appendChild(typeRow);
  filterContainer.appendChild(priorityRow);
  filterContainer.appendChild(localityRow);

  const subtitle = document.querySelector(".map-header-subtitle");
  if (subtitle && !document.getElementById("visible-count")) {
    subtitle.innerHTML = 'Explorer · <span id="visible-count">0 punti</span>';
  }
}

function injectAdvancedFilterStyles() {
  if (document.getElementById("advanced-filter-styles")) return;
  const style = document.createElement("style");
  style.id = "advanced-filter-styles";
  style.textContent = `
    .map-filters {
      display: block !important;
      top: 132px !important;
      padding: 7px 0 4px !important;
      overflow: visible !important;
      pointer-events: none;
    }
    .travel-filter-row {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding: 4px 14px 7px;
      scrollbar-width: none;
      pointer-events: auto;
    }
    .travel-filter-row::-webkit-scrollbar { display: none; }
    .priority-row, .locality-row { padding-top: 0; }
    .travel-filter-label {
      flex: 0 0 auto;
      padding-right: 3px;
      color: #6e6e73;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .7px;
    }
    .priority-filter, .locality-filter { font-size: 12px !important; }
    .travel-popup-local {
      display: inline-block;
      margin: 0 0 7px 5px;
      padding: 5px 8px;
      border-radius: 10px;
      background: #eef7ee;
      color: #3b613b;
      font-size: 10px;
      font-weight: 750;
    }
  `;
  document.head.appendChild(style);
}



function markerSearchText(marker) {

  const item =
    marker.travelExplorerItem ||
    {};

  return [
    item.name,
    item.area,
    item.description,
    ...(item.categories || []),
    ...(item.tags || [])
  ]
  .filter(Boolean)
  .join(" ")
  .toLowerCase();

}


function markerMatchesSearch(
  marker,
  term
) {

  const query =
    String(term || "")
      .trim()
      .toLowerCase();

  if (!query) return true;

  return markerSearchText(marker)
    .includes(query);

}


function setupMapSearch(
  map,
  mapMarkers,
  options
) {

  if (
    document.getElementById(
      "map-search-box"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "map-search-styles";

  style.textContent = `
    .map-search-shell {
      position: absolute;
      top: 82px;
      left: 14px;
      right: 14px;
      z-index: 1400;
      pointer-events: auto;
    }

    .map-search-box {
      width: 100%;
      box-sizing: border-box;
      min-height: 44px;
      border: 0;
      border-radius: 15px;
      padding: 0 44px 0 15px;
      background: rgba(255,255,255,.97);
      color: #1d1d1f;
      font-size: 14px;
      box-shadow: 0 5px 22px rgba(0,0,0,.14);
      outline: none;
    }

    .map-search-clear {
      position: absolute;
      top: 6px;
      right: 7px;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: #f0f0f2;
      color: #626267;
      font-size: 14px;
      cursor: pointer;
    }

    .map-search-results {
      display: none;
      margin-top: 6px;
      max-height: 300px;
      overflow-y: auto;
      border-radius: 16px;
      background: rgba(255,255,255,.98);
      box-shadow: 0 6px 24px rgba(0,0,0,.16);
    }

    .map-search-results.open {
      display: block;
    }

    .map-search-result {
      display: block;
      width: 100%;
      border: 0;
      border-bottom: 1px solid #ededf0;
      background: transparent;
      padding: 11px 13px;
      text-align: left;
      cursor: pointer;
    }

    .map-search-result:last-child {
      border-bottom: 0;
    }

    .map-search-result strong {
      display: block;
      color: #1d1d1f;
      font-size: 12px;
    }

    .map-search-result span {
      display: block;
      margin-top: 3px;
      color: #8e8e93;
      font-size: 9px;
    }

    .map-search-empty {
      padding: 13px;
      color: #77777c;
      font-size: 11px;
    }
  `;

  document.head.appendChild(
    style
  );

  const shell =
    document.createElement(
      "div"
    );

  shell.className =
    "map-search-shell";

  shell.innerHTML = `
    <input
      id="map-search-box"
      class="map-search-box"
      type="search"
      placeholder="🔎 Cerca tra i 400 POI..."
      autocomplete="off"
    >

    <button
      id="map-search-clear"
      class="map-search-clear"
      type="button"
      aria-label="Cancella ricerca"
    >
      ✕
    </button>

    <div
      id="map-search-results"
      class="map-search-results"
    ></div>
  `;

  document.body.appendChild(
    shell
  );

  const input =
    shell.querySelector(
      "#map-search-box"
    );

  const clear =
    shell.querySelector(
      "#map-search-clear"
    );

  const results =
    shell.querySelector(
      "#map-search-results"
    );

  function renderResults() {

    const term =
      input.value
        .trim()
        .toLowerCase();

    options.onSearchChange(
      term
    );

    if (
      term.length <
      2
    ) {

      results.classList.remove(
        "open"
      );

      results.innerHTML =
        "";

      return;

    }

    const matches =
      mapMarkers
        .filter(
          marker =>
            markerMatchesSearch(
              marker,
              term
            )
        )
        .sort(
          (a, b) => {

            const aName =
              (
                a.travelExplorerItem
                  ?.name ||
                ""
              )
              .toLowerCase();

            const bName =
              (
                b.travelExplorerItem
                  ?.name ||
                ""
              )
              .toLowerCase();

            const aStarts =
              aName.startsWith(
                term
              );

            const bStarts =
              bName.startsWith(
                term
              );

            if (
              aStarts !==
              bStarts
            ) {
              return aStarts
                ? -1
                : 1;
            }

            return aName
              .localeCompare(
                bName,
                "it"
              );

          }
        )
        .slice(
          0,
          12
        );

    results.classList.add(
      "open"
    );

    if (
      !matches.length
    ) {

      results.innerHTML = `
        <div class="map-search-empty">
          Nessun POI trovato.
        </div>
      `;

      return;

    }

    results.innerHTML =
      "";

    matches.forEach(
      marker => {

        const item =
          marker.travelExplorerItem;

        const button =
          document.createElement(
            "button"
          );

        button.type =
          "button";

        button.className =
          "map-search-result";

        button.innerHTML = `
          <strong>
            ${escapeHTML(
              item.name
            )}
          </strong>

          <span>
            ${escapeHTML(
              item.area ||
              ""
            )}
            ·
            ${escapeHTML(
              item.priority?.icon ||
              ""
            )}
            ${escapeHTML(
              item.priority?.label ||
              ""
            )}
            ${
              item.locality
                ?.veryLocal
                  ? " · 🏘️ Very Local"
                  : ""
            }
          </span>
        `;

        button.addEventListener(
          "click",
          () => {

            input.value =
              item.name;

            results.classList.remove(
              "open"
            );

            options.onFocusMarker(
              marker,
              item.name
            );

            map.setView(
              marker.getLatLng(),
              15
            );

            setTimeout(
              () =>
                marker.openPopup(),
              120
            );

          }
        );

        results.appendChild(
          button
        );

      }
    );

  }

  input.addEventListener(
    "input",
    renderResults
  );

  input.addEventListener(
    "focus",
    renderResults
  );

  clear.addEventListener(
    "click",
    () => {

      input.value =
        "";

      results.innerHTML =
        "";

      results.classList.remove(
        "open"
      );

      options.onClear();

      input.focus();

    }
  );

  document.addEventListener(
    "click",
    event => {

      if (
        !shell.contains(
          event.target
        )
      ) {

        results.classList.remove(
          "open"
        );

      }

    }
  );

}

async function initializeMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  createAdvancedMapFilters();
  injectAdvancedFilterStyles();

  const map = L.map("map").setView([-20.28, 57.55], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  const mapMarkers = [];

  for (const [databaseType, filename] of Object.entries(DATABASES)) {
    const items = await loadJSON(filename);
    items.forEach(rawItem => {
      const item = normalizeItem(rawItem, databaseType);
      if (item.latitude === undefined || item.longitude === undefined) return;

      const marker = L.circleMarker([item.latitude, item.longitude], {
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: getMarkerColor(item, databaseType),
        fillOpacity: 1
      }).addTo(map);

      marker.travelExplorerType = databaseType;
      marker.travelExplorerCategories = item.categories;
      marker.travelExplorerPriority = item.priority.level;
      marker.travelExplorerVeryLocal = item.locality.veryLocal;
      marker.travelExplorerItem = item;

      const categoryText = item.categories.length ? item.categories.join(" • ") : databaseType;
      const ratingData = getRatingData(item.reviews);
      const bits = [];
      if (ratingData) bits.push(`⭐ ${escapeHTML(ratingData.rating)}`);
      if (item.practical.duration) bits.push(`⏱ ${escapeHTML(item.practical.duration)}`);
      const price = formatCurrency(item.practical.ticket, item.practical.currency);
      if (price) bits.push(`💰 ${escapeHTML(price)}`);

      marker.bindPopup(`
        <div class="travel-popup">
          <div class="travel-popup-priority">${escapeHTML(item.priority.icon)} ${escapeHTML(item.priority.label)}</div>
          ${item.locality.veryLocal ? `<div class="travel-popup-local">🏘️ Very local</div>` : ""}
          <div class="travel-popup-category">${escapeHTML(categoryText)}</div>
          <div class="travel-popup-title">${escapeHTML(item.name)}</div>
          ${bits.length ? `<div class="popup-quick-info">${bits.join(" &nbsp; ")}</div>` : ""}
          ${item.description ? `<div class="travel-popup-description">${escapeHTML(item.description)}</div>` : ""}
          ${item.id ? `<a class="travel-popup-button" href="pages/place.html?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(databaseType)}">Apri scheda completa →</a>` : ""}
        </div>
      `);

      mapMarkers.push(marker);
    });
  }

  let activeCategoryFilter = "all";
  let activePriorityFilter = "all";
  let activeLocalityFilter = "all";
  let activeSearchTerm = "";

  function applyMapFilters() {
    let count = 0;
    mapMarkers.forEach(marker => {
      const visible =
        matchesCategoryFilter(activeCategoryFilter, marker) &&
        matchesPriorityFilter(activePriorityFilter, marker) &&
        matchesLocalityFilter(activeLocalityFilter, marker) &&
        markerMatchesSearch(marker, activeSearchTerm);
      if (visible) { marker.addTo(map); count++; }
      else map.removeLayer(marker);
    });
    const counter = document.getElementById("visible-count");
    if (counter) counter.textContent = count === 1 ? "1 punto" : `${count} punti`;
  }

  document.querySelectorAll('.filter-button[data-filter-group]').forEach(button => {
    button.addEventListener("click", function () {
      const group = this.dataset.filterGroup;
      const value = this.dataset.filter;
      document.querySelectorAll(`.filter-button[data-filter-group="${group}"]`).forEach(btn => btn.classList.remove("active"));
      this.classList.add("active");
      if (group === "category") activeCategoryFilter = value;
      if (group === "priority") activePriorityFilter = value;
      if (group === "locality") activeLocalityFilter = value;
      applyMapFilters();
    });
  });

  setupMapSearch(
    map,
    mapMarkers,
    {
      onSearchChange(term) {
        activeSearchTerm = term;
        applyMapFilters();
      },

      onFocusMarker(marker, term) {
        activeCategoryFilter = "all";
        activePriorityFilter = "all";
        activeLocalityFilter = "all";
        activeSearchTerm = String(term || "").toLowerCase();

        document
          .querySelectorAll(
            '.filter-button[data-filter-group]'
          )
          .forEach(button => {
            button.classList.remove("active");

            if (
              button.dataset.filter ===
              "all"
            ) {
              button.classList.add("active");
            }
          });

        applyMapFilters();
      },

      onClear() {
        activeSearchTerm = "";
        applyMapFilters();
      }
    }
  );

  applyMapFilters();
}

async function initializePlacePage() {
  const placePage = document.getElementById("place-page");
  if (!placePage) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const requestedType = params.get("type") || "place";
  if (!id) return showPlaceError("Elemento non specificato.");

  const filename = DATABASES[requestedType] || DATABASES.place;
  const items = await loadJSON(filename);
  const rawItem = items.find(item => item.id === id);
  if (!rawItem) return showPlaceError("Elemento non trovato nel database.");

  const item = normalizeItem(rawItem, requestedType);
  renderPlacePage(item);
  await renderNearby(item);
}

function renderPlacePage(item) {
  document.title = `${item.name} | Travel Explorer`;
  document.getElementById("place-name").textContent = item.name;
  document.getElementById("place-area").textContent = item.area || "—";
  document.getElementById("place-duration").textContent = item.practical.duration || "—";

  renderCategories(item);
  renderQuickInfo(item);
  renderDescription(item);
  renderHistory(item);
  renderMustTry(item);
  renderActivities(item);
  renderInterests(item.interest);
  renderExperience(item.experience);
  renderReviews(item.reviews);
  renderPractical(item.practical);
  renderRestaurant(item.restaurant);
  renderGeology(item.geology);
  renderConditions(item.conditions);
  renderPhotography(item.photography);
  renderNotes(item.notes);
  renderLinks(item.links, item);

  const itineraryButton = document.getElementById("add-itinerary-button");
  if (itineraryButton) {
    itineraryButton.disabled = false;
    itineraryButton.textContent = "＋ Aggiungi all’itinerario";
    itineraryButton.addEventListener("click", () => openAddToItineraryChooser(item));
  }

  const navigateButton = document.getElementById("navigate-button");
  if (navigateButton && item.latitude !== undefined && item.longitude !== undefined) {
    navigateButton.addEventListener("click", () => {
      const url = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(`${item.latitude},${item.longitude}`);
      window.open(url, "_blank");
    });
  }
}

function renderCategories(item) {
  const container = document.getElementById("place-categories");
  if (!container) return;
  container.innerHTML = "";
  const priority = document.createElement("span");
  priority.className = "place-tag";
  priority.textContent = `${item.priority.icon} ${item.priority.label}`;
  container.appendChild(priority);

  if (item.locality.veryLocal) {
    const localTag = document.createElement("span");
    localTag.className = "place-tag";
    localTag.textContent = "🏘️ Posto very local";
    container.appendChild(localTag);
  }

  item.categories.forEach(category => {
    const tag = document.createElement("span");
    tag.className = "place-tag";
    tag.textContent = category;
    container.appendChild(tag);
  });
}

function renderQuickInfo(item) {
  const rating = getRatingData(item.reviews);
  if (rating) {
    document.getElementById("quick-rating").textContent = rating.rating;
    document.getElementById("quick-reviews").textContent = rating.count ? `${Number(rating.count).toLocaleString("it-IT")} recensioni` : rating.source;
  } else hideSection("rating-box");

  const price = formatCurrency(item.practical.ticket, item.practical.currency);
  if (price) document.getElementById("quick-price").textContent = price;
  else if (item.practical.price_range) document.getElementById("quick-price").textContent = item.practical.price_range;
  else hideSection("price-box");
}

function renderDescription(item) {
  if (!item.description && !item.whyGo) return hideSection("description-section");
  document.getElementById("place-description").textContent = item.description;
  const whyContainer = document.getElementById("why-go-container");
  if (item.whyGo) document.getElementById("place-why-go").textContent = item.whyGo;
  else if (whyContainer) whyContainer.style.display = "none";
}

function renderHistory(item) {
  if (!item.history) return hideSection("history-section");
  document.getElementById("place-history").textContent = item.history;
}

function renderMustTry(item) {
  if (!Array.isArray(item.mustTry) || !item.mustTry.length) return hideSection("must-try-section");
  const container = document.getElementById("must-try-list");
  container.innerHTML = "";
  item.mustTry.forEach(value => {
    const chip = document.createElement("span");
    chip.className = "food-chip";
    chip.textContent = value;
    container.appendChild(chip);
  });
}

function renderActivities(item) {
  if (!Array.isArray(item.activityOptions) || !item.activityOptions.length) return hideSection("activities-section");
  const container = document.getElementById("activity-options");
  container.innerHTML = "";
  item.activityOptions.forEach(activity => {
    const details = [];
    if (activity.duration_min) details.push(`⏱ ${activity.duration_min}${activity.duration_max ? `–${activity.duration_max}` : ""} min`);
    if (activity.distance_m) details.push(`📏 ${activity.distance_m} m`);
    if (activity.distance_min_km) details.push(`🥾 ${activity.distance_min_km}${activity.distance_max_km ? `–${activity.distance_max_km}` : ""} km`);
    if (activity.height_m) details.push(`↕️ ${activity.height_m} m`);
    if (activity.adrenaline) details.push(`⚡ ${starString(activity.adrenaline)}`);
    const price = formatCurrency(activity.price, activity.currency);
    if (price) details.push(`💰 ${price}`);

    const card = document.createElement("div");
    card.className = "activity-card";
    card.innerHTML = `
      <div class="activity-title">${escapeHTML(activity.name)}</div>
      <div class="activity-meta">${details.map(x => `<span>${escapeHTML(x)}</span>`).join("")}</div>
      ${activity.difficulty ? `<div class="activity-note">Difficoltà: ${escapeHTML(activity.difficulty)}</div>` : ""}
      ${activity.notes ? `<div class="activity-note">${escapeHTML(activity.notes)}</div>` : ""}
    `;
    container.appendChild(card);
  });
}

function renderInterests(interests) {
  const labels = { nature: "🌿 Natura", culture: "🛕 Cultura", geology: "🌋 Geologia", food: "🍛 Food", photography: "📷 Fotografia", adventure: "🧗 Avventura", relax: "🌴 Relax", history: "🏛️ Storia", sea: "🌊 Mare" };
  const available = Object.entries(interests || {}).filter(([, value]) => typeof value === "number" && value > 0);
  if (!available.length) return hideSection("interest-section");
  const container = document.getElementById("place-interests");
  container.innerHTML = available.map(([key, value]) => `<div class="interest-row"><span>${escapeHTML(labels[key] || key)}</span><strong>${starString(value)}</strong></div>`).join("");
}

function renderExperience(experience) {
  if (!experience) return hideSection("experience-section");
  const rows = [];
  if (typeof experience.authenticity === "number") rows.push(["Autenticità", starString(experience.authenticity)]);
  if (typeof experience.local_score === "number") rows.push(["Esperienza locale", starString(experience.local_score)]);
  if (typeof experience.touristic_score === "number") rows.push(["Turistico", starString(experience.touristic_score)]);
  if (!rows.length && !experience.best_for) return hideSection("experience-section");

  const container = document.getElementById("experience-content");
  container.innerHTML = rows.map(row => `<div class="interest-row"><span>${escapeHTML(row[0])}</span><strong>${escapeHTML(row[1])}</strong></div>`).join("");

  if (Array.isArray(experience.best_for) && experience.best_for.length) {
    const title = document.createElement("div");
    title.className = "subsection-title";
    title.textContent = "Ideale per";
    container.appendChild(title);
    const chips = document.createElement("div");
    chips.className = "chip-list";
    experience.best_for.forEach(value => {
      const chip = document.createElement("span");
      chip.className = "food-chip";
      chip.textContent = value;
      chips.appendChild(chip);
    });
    container.appendChild(chips);
  }
}

function renderReviews(reviews) {
  const rating = getRatingData(reviews);
  if (!rating && !reviews?.summary) return hideSection("reviews-section");
  const container = document.getElementById("reviews-content");
  container.innerHTML = "";

  if (rating) {
    const hero = document.createElement("div");
    hero.className = "review-score";
    hero.innerHTML = `<strong>⭐ ${escapeHTML(rating.rating)}</strong>${rating.count ? `<span>${Number(rating.count).toLocaleString("it-IT")} recensioni</span>` : ""}${rating.source ? `<small>Fonte: ${escapeHTML(rating.source)}</small>` : ""}`;
    container.appendChild(hero);
  }

  if (reviews.summary) {
    const summary = document.createElement("div");
    summary.className = "review-summary";
    summary.innerHTML = `<strong>Sintesi delle recensioni disponibili</strong><p>${escapeHTML(reviews.summary)}</p>`;
    container.appendChild(summary);
  }
}

function renderDetailRows(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = rows.map(row => `<div class="detail-row"><span>${escapeHTML(row[0])}</span><strong>${escapeHTML(row[1])}</strong></div>`).join("");
}

function renderPractical(practical) {
  const data = [];
  if (practical.opening || practical.closing) data.push(["🕘 Orario", [practical.opening, practical.closing].filter(Boolean).join(" – ")]);
  if (practical.hours_note) data.push(["📅 Nota orari", practical.hours_note]);
  if (Array.isArray(practical.best_days) && practical.best_days.length) data.push(["📆 Giorni migliori", practical.best_days.join(", ")]);
  const booking = yesNo(practical.reservation_required); if (booking !== null) data.push(["🎟 Prenotazione", booking]);
  const parking = yesNo(practical.parking); if (parking !== null) data.push(["🅿️ Parcheggio", parking]);
  if (practical.payment) data.push(["💳 Pagamento", practical.payment]);
  if (practical.price_range) data.push(["💰 Fascia prezzo", practical.price_range]);
  if (practical.accessibility) data.push(["♿ Accessibilità", practical.accessibility]);
  if (practical.access_notes) data.push(["⚠️ Accesso", practical.access_notes]);
  if (!data.length) return hideSection("practical-section");
  renderDetailRows("practical-content", data);
}

function renderRestaurant(restaurant) {
  if (!restaurant) return hideSection("restaurant-section");
  const container = document.getElementById("restaurant-content");
  let html = `<h3>${escapeHTML(restaurant.name || "Ristorante")}</h3>`;
  if (restaurant.opening || restaurant.closing) html += `<p>🕘 ${escapeHTML(restaurant.opening || "")}${restaurant.closing ? ` – ${escapeHTML(restaurant.closing)}` : ""}</p>`;
  if (restaurant.reservation_recommended) html += `<p>📞 Prenotazione consigliata</p>`;
  if (restaurant.visit_and_tasting_included_with_lunch) html += `<p>✨ Visita e degustazione possono essere incluse con il pranzo.</p>`;
  container.innerHTML = html;
}

function renderGeology(geology) {
  const data = [];
  if (geology.origin) data.push(["Origine", geology.origin]);
  if (geology.rock) data.push(["Litologia", geology.rock]);
  if (geology.process) data.push(["Processi", geology.process]);
  if (!data.length) return hideSection("geology-section");
  const container = document.getElementById("geology-content");
  container.innerHTML = data.map(row => `<div class="geology-block"><strong>${escapeHTML(row[0])}</strong><p>${escapeHTML(row[1])}</p></div>`).join("");
  if (typeof geology.interest === "number" && geology.interest > 0) container.innerHTML += `<div class="interest-row"><span>Interesse geologico</span><strong>${starString(geology.interest)}</strong></div>`;
}

function renderConditions(conditions) {
  const data = [];
  if (conditions.best_time_of_day) data.push(["🕘 Momento migliore", conditions.best_time_of_day]);
  if (typeof conditions.wind_sensitivity === "number") data.push(["🌬 Sensibilità al vento", starString(conditions.wind_sensitivity)]);
  if (typeof conditions.rain_sensitivity === "number") data.push(["🌧 Sensibilità alla pioggia", starString(conditions.rain_sensitivity)]);
  if (typeof conditions.crowd_sensitivity === "number") data.push(["👥 Affollamento", starString(conditions.crowd_sensitivity)]);
  if (conditions.weather_check_required) data.push(["⚠️ Meteo", "Controllare le condizioni prima della visita"]);
  if (conditions.avoid_after_heavy_rain) data.push(["⚠️ Pioggia intensa", "Da evitare dopo precipitazioni importanti"]);
  if (!data.length) return hideSection("conditions-section");
  renderDetailRows("conditions-content", data);
}

function renderPhotography(photo) {
  const data = [];
  if (typeof photo.score === "number") data.push(["📷 Interesse fotografico", starString(photo.score)]);
  if (photo.best_time) data.push(["🕘 Luce migliore", photo.best_time]);
  if (photo.sunrise === true) data.push(["🌅 Alba", "Consigliata"]);
  if (photo.sunset === true) data.push(["🌇 Tramonto", "Consigliato"]);
  if (photo.drone) data.push(["🚁 Drone", photo.drone]);
  if (!data.length) return hideSection("photography-section");
  renderDetailRows("photography-content", data);
}

async function renderNearby(item) {
  const ids = [...item.placesNearby, ...item.foodNearby, ...item.activities].filter(Boolean);
  if (!ids.length) return hideSection("nearby-section");
  const found = [];
  for (const [type, filename] of Object.entries(DATABASES)) {
    const items = await loadJSON(filename);
    items.forEach(raw => {
      if (ids.includes(raw.id)) found.push(normalizeItem(raw, type));
    });
  }
  if (!found.length) return hideSection("nearby-section");

  const container = document.getElementById("nearby-content");
  container.innerHTML = "";
  found.forEach(nearby => {
    const link = document.createElement("a");
    link.className = "nearby-card";
    link.href = `place.html?id=${encodeURIComponent(nearby.id)}&type=${encodeURIComponent(nearby.type)}`;
    link.innerHTML = `<strong>${escapeHTML(nearby.name)}</strong><span>${escapeHTML(nearby.area)}</span>`;
    container.appendChild(link);
  });
}

function renderNotes(notes) {
  if (!notes) return hideSection("notes-section");
  document.getElementById("place-notes").textContent = notes;
}

function renderLinks(links, item) {
  const container = document.getElementById("place-links");
  const definitions = [
    ["official", "🌐 Sito ufficiale"], ["booking", "🎟 Prenotazione"], ["wikipedia", "📖 Wikipedia"],
    ["unesco", "🏛️ UNESCO"], ["science", "🔬 Fonte scientifica"], ["reviews", "⭐ Recensioni"], ["maps", "🗺️ Mappa"]
  ];
  let count = 0;
  definitions.forEach(([key, label]) => {
    if (!links[key]) return;
    const a = document.createElement("a");
    a.href = links[key]; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "place-link"; a.textContent = label;
    container.appendChild(a); count++;
  });

  if (item.latitude !== undefined && item.longitude !== undefined) {
    const maps = document.createElement("a");
    maps.className = "place-link"; maps.target = "_blank"; maps.rel = "noopener noreferrer";
    maps.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${item.latitude},${item.longitude}`);
    maps.textContent = "📍 Apri in Google Maps";
    container.appendChild(maps); count++;
  }
  if (!count) hideSection("links-section");
}


// ======================================================
// AGGIUNGI POI A ITINERARIO / TEMPLATE V5.1
// ======================================================

const PLACE_ROUTE_STORE_KEY =
  "mauritius-2026-route-overrides-v2";

const PLACE_TEMPLATE_ADDITIONS_KEY =
  "mauritius-2026-template-additions-v1";

let placeTravelStorePromise = null;
let placeTemplateCache = null;

async function ensurePlaceTravelStore() {
  if (window.TravelStore) return window.TravelStore;
  if (placeTravelStorePromise) return placeTravelStorePromise;

  placeTravelStorePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("../travel-store.js", window.location.href).href;
    script.onload = () => {
      if (window.TravelStore) resolve(window.TravelStore);
      else reject(new Error("TravelStore non disponibile"));
    };
    script.onerror = () => reject(new Error("Impossibile caricare travel-store.js"));
    document.head.appendChild(script);
  });

  return placeTravelStorePromise;
}

async function loadPlaceTemplates() {
  if (placeTemplateCache) return placeTemplateCache;

  const response = await fetch(
    new URL("../data/route-templates.json", window.location.href).href,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Impossibile caricare route-templates.json");
  }

  const payload = await response.json();
  placeTemplateCache = Array.isArray(payload.templates) ? payload.templates : [];
  return placeTemplateCache;
}

async function loadCurrentTripForPlace() {
  const store = await ensurePlaceTravelStore();
  let trip = await store.get(PLACE_ROUTE_STORE_KEY);

  if (trip && Array.isArray(trip.days)) return trip;

  const response = await fetch(
    new URL("../data/routes.json", window.location.href).href,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Impossibile caricare routes.json");
  }

  return response.json();
}

function injectPlaceItineraryChooserStyles() {
  if (document.getElementById("place-itinerary-chooser-style")) return;

  const style = document.createElement("style");
  style.id = "place-itinerary-chooser-style";
  style.textContent = `
    .place-itinerary-backdrop {
      position: fixed;
      inset: 0;
      z-index: 12000;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 12px;
      background: rgba(0,0,0,.45);
    }
    .place-itinerary-sheet {
      width: min(720px, 100%);
      max-height: 88vh;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 18px;
      border-radius: 24px 24px 18px 18px;
      background: #fff;
      color: #1d1d1f;
      box-shadow: 0 24px 70px rgba(0,0,0,.25);
    }
    .place-itinerary-sheet h2 {
      margin: 0 0 5px;
      font-size: 21px;
    }
    .place-itinerary-sheet > p {
      margin: 0 0 14px;
      color: #6e6e73;
      font-size: 11px;
      line-height: 1.45;
    }
    .place-itinerary-group-title {
      margin: 16px 0 8px;
      color: #77777c;
      font-size: 10px;
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: .5px;
    }
    .place-itinerary-list {
      display: grid;
      gap: 8px;
    }
    .place-itinerary-option {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 12px;
      border-radius: 15px;
      background: #f5f5f7;
    }
    .place-itinerary-option strong {
      display: block;
      font-size: 12px;
    }
    .place-itinerary-option span {
      display: block;
      margin-top: 4px;
      color: #77777c;
      font-size: 9px;
      line-height: 1.35;
    }
    .place-itinerary-add {
      min-height: 36px;
      border: 0;
      border-radius: 11px;
      padding: 0 10px;
      background: #1d1d1f;
      color: #fff;
      font-size: 10px;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    }
    .place-itinerary-add.added {
      background: #e7f6eb;
      color: #176b35;
    }
    .place-itinerary-message {
      margin-top: 12px;
      padding: 11px;
      border-radius: 13px;
      background: #eef6ff;
      color: #315775;
      font-size: 10px;
      line-height: 1.45;
    }
    .place-itinerary-close {
      width: 100%;
      min-height: 46px;
      margin-top: 12px;
      border: 0;
      border-radius: 14px;
      background: #ececef;
      color: #1d1d1f;
      font-weight: 800;
      cursor: pointer;
    }
    @media (min-width: 620px) {
      .place-itinerary-backdrop { align-items: center; }
      .place-itinerary-sheet { border-radius: 24px; }
    }
  `;
  document.head.appendChild(style);
}

function templateAssignedDates(template, trip) {
  if (!trip || !Array.isArray(trip.days)) return [];

  const normalizedTemplateTitle = String(template.title || "").trim().toLowerCase();

  return trip.days
    .filter((day, index) => {
      if (index === 0 || index === trip.days.length - 1) return false;
      if (day._template_id === template.id) return true;

      if (!day._template_id && template.source_group === "original") {
        return String(day.title || "").trim().toLowerCase() === normalizedTemplateTitle;
      }

      return false;
    })
    .map(day => day.date);
}

function formatPlaceTripDate(dateValue) {
  if (!dateValue) return "";
  const parts = String(dateValue).split("-").map(Number);
  if (parts.length !== 3) return String(dateValue);

  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function placePOIDurationMinutes(item) {
  const practical = item.practical || {};
  const raw = item.raw || {};

  const numeric =
    practical.duration_recommended ??
    practical.duration_min ??
    raw.duration_recommended ??
    raw.duration_min;

  if (Number.isFinite(Number(numeric))) return Number(numeric);

  const text = String(practical.duration || raw.duration || "");
  const minRange = text.match(/(\d+)\s*[-–]\s*(\d+)\s*min/i);
  if (minRange) return Math.round((Number(minRange[1]) + Number(minRange[2])) / 2);

  const singleMin = text.match(/(\d+)\s*min/i);
  if (singleMin) return Number(singleMin[1]);

  const hourRange = text.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(?:h|ore?)/i);
  if (hourRange) {
    const a = Number(hourRange[1].replace(",", "."));
    const b = Number(hourRange[2].replace(",", "."));
    return Math.round((a + b) / 2 * 60);
  }

  if (item.type === "food") return 45;
  if (item.type === "adventure") return 120;
  return 50;
}

function buildPlaceItineraryBlock(item, templateId) {
  return {
    kind:
      item.type === "adventure"
        ? "activity"
        : item.type === "food"
          ? "meal"
          : "visit",
    time: "00:00",
    duration_minutes: placePOIDurationMinutes(item),
    poi_id: item.id,
    poi_type: item.type,
    title: item.name,
    description: "Tappa aggiunta dalla scheda POI.",
    _uid:
      "poi-" +
      item.id +
      "-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 6),
    _locked: false,
    _manual_from_poi: true,
    _template_id_origin: templateId
  };
}

function placeTimeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 8 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

function placeMinutesToTime(value) {
  const normalized = ((Number(value) % 1440) + 1440) % 1440;
  return String(Math.floor(normalized / 60)).padStart(2, "0") + ":" + String(normalized % 60).padStart(2, "0");
}

function reflowPlaceTripDay(day) {
  if (!day || !Array.isArray(day.blocks) || !day.blocks.length) return;

  let cursor = placeTimeToMinutes(day.blocks[0].time || "08:00");

  day.blocks.forEach((block, index) => {
    if (index === 0) cursor = placeTimeToMinutes(block.time || "08:00");
    block.time = placeMinutesToTime(cursor);
    cursor += Number(block.duration_minutes) || 0;
  });
}

function insertPlaceBlockSmart(day, block) {
  if (!Array.isArray(day.blocks)) day.blocks = [];

  if (day.blocks.some(existing => existing.poi_id === block.poi_id)) {
    return false;
  }

  let insertIndex = day.blocks.length;

  for (let i = day.blocks.length - 1; i >= 0; i--) {
    const current = day.blocks[i];
    const title = String(current.title || "").toLowerCase();

    if (
      current.kind === "hotel" ||
      (current.kind === "transfer" && (
        title.includes("tamarin") ||
        title.includes("rientro") ||
        title.includes("hotel")
      ))
    ) {
      insertIndex = i;
      continue;
    }

    break;
  }

  day.blocks.splice(insertIndex, 0, block);
  day._completed = false;
  reflowPlaceTripDay(day);
  return true;
}

async function savePOIToTemplate(item, template) {
  const store = await ensurePlaceTravelStore();

  const additions =
    (await store.get(PLACE_TEMPLATE_ADDITIONS_KEY)) || {};

  const templateItems =
    Array.isArray(additions[template.id])
      ? additions[template.id]
      : [];

  const alreadyInTemplate = templateItems.some(block => block.poi_id === item.id);

  if (!alreadyInTemplate) {
    templateItems.push(buildPlaceItineraryBlock(item, template.id));
    additions[template.id] = templateItems;
    await store.set(PLACE_TEMPLATE_ADDITIONS_KEY, additions);
  }

  const trip = await loadCurrentTripForPlace();
  const assignedDates = templateAssignedDates(template, trip);
  let activeDayUpdated = false;

  trip.days.forEach((day, index) => {
    if (index === 0 || index === trip.days.length - 1) return;

    const match =
      day._template_id === template.id ||
      (
        !day._template_id &&
        template.source_group === "original" &&
        String(day.title || "").trim().toLowerCase() ===
          String(template.title || "").trim().toLowerCase()
      );

    if (!match) return;

    const block = buildPlaceItineraryBlock(item, template.id);
    if (insertPlaceBlockSmart(day, block)) activeDayUpdated = true;
  });

  if (activeDayUpdated) {
    await store.set(PLACE_ROUTE_STORE_KEY, trip);
  }

  return {
    alreadyInTemplate,
    assignedDates,
    activeDayUpdated
  };
}

async function openAddToItineraryChooser(item) {
  injectPlaceItineraryChooserStyles();

  const existing = document.getElementById("place-itinerary-backdrop");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "place-itinerary-backdrop";
  backdrop.className = "place-itinerary-backdrop";

  backdrop.innerHTML = `
    <div class="place-itinerary-sheet">
      <h2>＋ Aggiungi a un itinerario</h2>
      <p>
        Scegli uno dei 13 itinerari. Se è già assegnato a un giorno, <strong>${escapeHTML(item.name)}</strong>
        verrà inserito subito anche in quella giornata. Altrimenti resterà salvato nel template.
      </p>
      <div id="place-itinerary-options">
        <div class="place-itinerary-message">Caricamento itinerari…</div>
      </div>
      <div id="place-itinerary-message"></div>
      <button type="button" class="place-itinerary-close">Chiudi</button>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.querySelector(".place-itinerary-close").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) backdrop.remove();
  });

  try {
    const [templates, trip, store] = await Promise.all([
      loadPlaceTemplates(),
      loadCurrentTripForPlace(),
      ensurePlaceTravelStore()
    ]);

    const additions =
      (await store.get(PLACE_TEMPLATE_ADDITIONS_KEY)) || {};

    const container = backdrop.querySelector("#place-itinerary-options");
    container.innerHTML = "";

    const groups = [
      ["original", "🌍 Travel Explorer"],
      ["dede", "💛 Dede"]
    ];

    groups.forEach(([groupId, groupLabel]) => {
      const groupTemplates = templates.filter(template => template.source_group === groupId);
      if (!groupTemplates.length) return;

      const title = document.createElement("div");
      title.className = "place-itinerary-group-title";
      title.textContent = groupLabel;
      container.appendChild(title);

      const list = document.createElement("div");
      list.className = "place-itinerary-list";

      groupTemplates.forEach(template => {
        const dates = templateAssignedDates(template, trip);
        const already = Array.isArray(additions[template.id]) &&
          additions[template.id].some(block => block.poi_id === item.id);

        const option = document.createElement("div");
        option.className = "place-itinerary-option";

        const status = dates.length
          ? "In uso: " + dates.map(formatPlaceTripDate).join(", ")
          : "Non ancora assegnato a un giorno";

        option.innerHTML = `
          <div>
            <strong>${escapeHTML(template.label || template.title)}</strong>
            <span>${escapeHTML(template.theme || "")} · ${escapeHTML(status)}</span>
          </div>
          <button type="button" class="place-itinerary-add ${already ? "added" : ""}">
            ${already ? "✓ Aggiunto" : "＋ Aggiungi"}
          </button>
        `;

        const button = option.querySelector(".place-itinerary-add");
        button.addEventListener("click", async () => {
          button.disabled = true;
          button.textContent = "Salvo…";

          try {
            const result = await savePOIToTemplate(item, template);
            button.classList.add("added");
            button.textContent = "✓ Aggiunto";

            const message = backdrop.querySelector("#place-itinerary-message");
            const assignedText = result.assignedDates.length
              ? ` È già assegnato a ${result.assignedDates.map(formatPlaceTripDate).join(", ")}: la giornata è stata aggiornata.`
              : " Non è ancora assegnato a un giorno: il POI comparirà automaticamente quando userai questo itinerario.";

            message.innerHTML = `
              <div class="place-itinerary-message">
                ✅ <strong>${escapeHTML(item.name)}</strong> aggiunto a
                <strong>${escapeHTML(template.label || template.title)}</strong>.${escapeHTML(assignedText)}
              </div>
            `;
          }
          catch (error) {
            console.error(error);
            button.disabled = false;
            button.textContent = "Riprova";
            const message = backdrop.querySelector("#place-itinerary-message");
            message.innerHTML = `
              <div class="place-itinerary-message">
                ⚠️ Non riesco a salvare il POI nell’itinerario. Controlla che il progetto sia aperto con Live Server.
              </div>
            `;
          }
        });

        list.appendChild(option);
      });

      container.appendChild(list);
    });
  }
  catch (error) {
    console.error(error);
    const container = backdrop.querySelector("#place-itinerary-options");
    container.innerHTML = `
      <div class="place-itinerary-message">
        ⚠️ Non riesco a caricare gli itinerari. Usa Live Server e controlla data/route-templates.json.
      </div>
    `;
  }
}

function showPlaceError(message) {
  const name = document.getElementById("place-name");
  const description = document.getElementById("place-description");
  if (name) name.textContent = "Errore";
  if (description) description.textContent = message;
}

document.addEventListener("DOMContentLoaded", () => {
  initializeMap();
  initializePlacePage();
});