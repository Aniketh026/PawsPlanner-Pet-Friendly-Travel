document.addEventListener("DOMContentLoaded", function () {
  // ============================================
  // API KEYS
  // ============================================
  var apiKeyPlaces = "da43079eeb9f490a8cddf2b3ed2dd1c4";
  var apiKeyWeather = "8fa17f3bf5819b35e5514a16ea6de259";

  // Nominatim (OpenStreetMap) - free geocoding
  var geocodeUrl = "https://nominatim.openstreetmap.org/search";

  var searchButton = $("#searchButton");
  var cityInput = $("#locationInput");
  var apiErrorDiv = $("#apiErrorMessage");

  // Current category filter
  var currentCategory = "pet";
  var currentLat = null;
  var currentLon = null;
  var currentLocationName = "";

  function showError(msg) {
    console.error("PAWS PLANNER ERROR:", msg);
    apiErrorDiv.text(msg).removeClass("d-none");
  }
  function clearError() {
    apiErrorDiv.addClass("d-none").text("");
  }

  // ============================================
  // THEME TOGGLE
  // ============================================
  var themeToggle = $("#themeToggle");
  var storedTheme = localStorage.getItem("paws-theme") || "light";
  $("html").attr("data-bs-theme", storedTheme);
  updateThemeIcon(storedTheme);

  themeToggle.on("click", function () {
    var current = $("html").attr("data-bs-theme");
    var next = current === "light" ? "dark" : "light";
    $("html").attr("data-bs-theme", next);
    localStorage.setItem("paws-theme", next);
    updateThemeIcon(next);
  });

  function updateThemeIcon(theme) {
    var icon = theme === "light" ? "bi-moon-fill" : "bi-sun-fill";
    themeToggle.html('<i class="bi ' + icon + '"></i>');
  }

  // ============================================
  // SEARCH HISTORY
  // ============================================
  var searchHistory = JSON.parse(localStorage.getItem("paws-search-history") || "[]");
  renderSearchHistory();

  function addToHistory(location) {
    if (!location) return;
    searchHistory = searchHistory.filter(function (item) {
      return item.toLowerCase() !== location.toLowerCase();
    });
    searchHistory.unshift(location);
    if (searchHistory.length > 6) searchHistory.pop();
    localStorage.setItem("paws-search-history", JSON.stringify(searchHistory));
    renderSearchHistory();
  }

  function renderSearchHistory() {
    var container = $("#searchHistory");
    container.empty();
    searchHistory.forEach(function (item) {
      var chip = $('<span class="badge bg-secondary search-chip">' + item + '</span>');
      chip.on("click", function () {
        cityInput.val(item);
        searchButton.trigger("click");
      });
      container.append(chip);
    });
  }

  // ============================================
  // USE MY LOCATION (GPS)
  // ============================================
  $("#useMyLocationBtn").on("click", function () {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser", "danger");
      return;
    }
    $("#useMyLocationBtn").html('<span class="spinner-border spinner-border-sm"></span>');
    navigator.geolocation.getCurrentPosition(
      function (position) {
        $("#useMyLocationBtn").html('<i class="bi bi-geo-alt-fill"></i>');
        reverseGeocode(position.coords.latitude, position.coords.longitude);
      },
      function () {
        $("#useMyLocationBtn").html('<i class="bi bi-geo-alt-fill"></i>');
        showToast("Unable to retrieve your location", "danger");
      }
    );
  });

  function reverseGeocode(lat, lon) {
    var url = "https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lon;
    fetch(url, { headers: { "User-Agent": "PawsPlannerApp/1.0" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var name = data.address && (data.address.city || data.address.town || data.address.village || data.address.suburb || "Current Location");
        cityInput.val(name);
        searchButton.trigger("click");
      })
      .catch(function () {
        showToast("Could not determine location name", "warning");
        cityInput.val(lat.toFixed(4) + ", " + lon.toFixed(4));
        searchButton.trigger("click");
      });
  }

  // ============================================
  // LEAFLET MAP
  // ============================================
  var map, mapMarkers = [];
  try {
    map = L.map("map").setView([51.505, -0.09], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
    }).addTo(map);
    $("#mapLoadingMsg").addClass("d-none");
  } catch (e) {
    showError("Failed to create map. Check console for details.");
    console.error(e);
    return;
  }

  $(window).on("resize", function () {
    if (map) map.invalidateSize();
  });

  setTimeout(function () {
    if (map) map.invalidateSize();
  }, 500);

  // ============================================
  // CATEGORY FILTERS
  // ============================================
  $("#categoryFilters").on("click", ".btn", function () {
    $("#categoryFilters .btn").removeClass("active");
    $(this).addClass("active");
    currentCategory = $(this).data("category");
    if (currentLat !== null && currentLon !== null) {
      fetchPlaces(currentLon, currentLat, currentLocationName);
    }
  });

  // ============================================
  // GEOCODING & SEARCH
  // ============================================
  function fetchData(location) {
    clearError();
    if (!location || !location.trim()) {
      showError("Please enter a location.");
      return;
    }
    currentLocationName = location.trim();
    addToHistory(currentLocationName);

    var url = geocodeUrl + "?q=" + encodeURIComponent(location) + "&format=json&limit=1";
    fetch(url, { headers: { "User-Agent": "PawsPlannerApp/1.0" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Geocode error: " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || data.length === 0) throw new Error("No matching location found.");
        var lon = parseFloat(data[0].lon);
        var lat = parseFloat(data[0].lat);
        currentLon = lon;
        currentLat = lat;
        moveMapToLocation(lat, lon);
        fetchPlaces(lon, lat, currentLocationName);
        fetchCurrentWeather(currentLocationName);
        fetchForecast(currentLocationName);
      })
      .catch(function (error) {
        showError("Error finding location: " + error.message);
      });
  }

  function moveMapToLocation(lat, lon) {
    map.setView([lat, lon], 13);
    setTimeout(function () { map.invalidateSize(); }, 100);
  }

  // ============================================
  // PLACES (Geoapify)
  // ============================================
  function fetchPlaces(lon, lat, locationName) {
    $("#activeCategories").empty();
    $("#eatCardContainer").empty();
    $("#noResults").addClass("d-none");
    $("#loadingStatus").removeClass("d-none");

    var radius = "10000";
    var queryURLPlaces = "https://api.geoapify.com/v2/places?categories=" + currentCategory + "&filter=circle:" + lon + "," + lat + "," + radius + "&bias=proximity:" + lon + "," + lat + "&lang=en&limit=20&apiKey=" + apiKeyPlaces;

    fetch(queryURLPlaces)
      .then(function (response) {
        if (!response.ok) throw new Error("Places API error: " + response.status);
        return response.json();
      })
      .then(function loadCards(result) {
        clearMapPins();
        if (!result.features || result.features.length === 0) {
          $("#loadingStatus").addClass("d-none");
          $("#noResults").removeClass("d-none");
          return;
        }

        result.features.forEach(function (searchResult) {
          var props = searchResult.properties;
          var eatName = props.name || "Unknown";
          var eatLocation = props.address_line2 || props.formatted || "Unknown";
          var raw = props.datasource && props.datasource.raw ? props.datasource.raw : {};
          var eatWebsiteLink = raw.website || null;
          var isEatLink = eatWebsiteLink ? "Visit website" : "No website";
          var eatOpeningHrs = raw.opening_hours || "Unknown";
          var eatWheelchair = raw.wheelchair || "Unknown";
          var eatDistance = props.distance || "N/A";
          var isDisabled = eatWebsiteLink ? "" : "disabled";
          var isAriaDisabled = eatWebsiteLink ? "false" : "true";
          var eatPhone = raw.phone || raw["contact:phone"] || null;
          var eatRating = raw.rating || props.rating || null;

          addPinToMap(props.lat, props.lon, eatName);

          // Generate rating HTML
          var ratingHtml = "";
          if (eatRating) {
            var stars = Math.round(parseFloat(eatRating));
            var starStr = "";
            for (var s = 0; s < 5; s++) {
              starStr += s < stars ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
            }
            ratingHtml = '<div class="star-rating mb-1">' + starStr + ' <span class="rating-badge">' + eatRating + '</span></div>';
          }

          // Unique ID for save/plan buttons
          var placeId = (props.place_id || (eatName + lat + lon)).toString().replace(/\s/g, "_");
          var isSaved = isPlaceSaved(placeId);
          var isPlanned = isPlacePlanned(placeId);
          var saveIcon = isSaved ? "bi-heart-fill text-danger" : "bi-heart";
          var planIcon = isPlanned ? "bi-calendar-check-fill text-success" : "bi-calendar-plus";

          var phoneHtml = eatPhone ? '<p class="my-0 monoText"><i class="bi bi-telephone me-2"></i>' + eatPhone + '</p>' : "";

          $("#eatCardContainer").append(
            '<div class="card rounded mx-1 col-5 col-lg-4" data-place-id="' + placeId + '" data-lat="' + props.lat + '" data-lon="' + props.lon + '" data-name="' + escapeHtml(eatName) + '" data-address="' + escapeHtml(eatLocation) + '">' +
              '<div class="card-body">' +
                '<p class="monoText my-0"><i class="bi bi-person-walking me-2"></i>' + eatDistance + 'm</p>' +
                '<h5 class="card-title mb-1">' + eatName + '</h5>' +
                ratingHtml +
                '<h6 class="card-subtitle mb-2 text-body-secondary"><i class="bi bi-geo-alt-fill me-2"></i>' + eatLocation + '</h6>' +
                '<p class="my-0 monoText"><i class="bi bi-clock me-2"></i>' + eatOpeningHrs + '</p>' +
                '<p class="my-0 monoText"><i class="bi bi-person-wheelchair me-2"></i>' + eatWheelchair + '</p>' +
                phoneHtml +
                '<a target="_blank" href="' + (eatWebsiteLink || "#") + '" class="btn btn-sm btn-primary rounded-pill mt-2 py-1 ' + isDisabled + '" aria-disabled="' + isAriaDisabled + '"><p class="my-0 monoText">' + isEatLink + '</p></a>' +
                '<div class="card-actions">' +
                  '<button class="btn btn-outline-danger btn-sm save-place-btn" data-place-id="' + placeId + '" title="Save place"><i class="bi ' + saveIcon + '"></i></button>' +
                  '<button class="btn btn-outline-success btn-sm add-to-plan-btn" data-place-id="' + placeId + '" title="Add to plan"><i class="bi ' + planIcon + '"></i></button>' +
                '</div>' +
              '</div>' +
            '</div>'
          );
        });

        $("#loadingStatus").addClass("d-none");
      })
      .catch(function (error) {
        $("#loadingStatus").addClass("d-none");
        $("#noResults").removeClass("d-none");
        showError("Error fetching nearby places: " + error.message);
      });
  }

  function escapeHtml(text) {
    if (!text) return "";
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // MAP PINS
  // ============================================
  function addPinToMap(lat, lon, title) {
    var marker = L.marker([lat, lon]).addTo(map);
    if (title) marker.bindPopup(title).openPopup();
    mapMarkers.push(marker);
  }

  function clearMapPins() {
    mapMarkers.forEach(function (marker) { map.removeLayer(marker); });
    mapMarkers = [];
  }

  // ============================================
  // CURRENT WEATHER
  // ============================================
  function fetchCurrentWeather(city) {
    var queryURL = "https://api.openweathermap.org/data/2.5/weather?q=" + encodeURIComponent(city) + "&units=metric&appid=" + apiKeyWeather;
    $.getJSON(queryURL, function (data) {
      var currentWeather = $("#todayWeather");
      currentWeather.empty();
      if (data.cod && data.cod !== 200) {
        showError("Weather API error: " + (data.message || "Unknown"));
        return;
      }
      var weatherTodayIcon = data.weather[0].icon;
      var todayIcon = '<img src="https://openweathermap.org/img/wn/' + weatherTodayIcon + '@2x.png"/>';
      var tempCelsius = data.main.temp.toFixed(1);
      var wind = (data.wind.speed * 3.6).toFixed(1);
      var humidity = data.main.humidity;
      var desc = data.weather[0].description;

      currentWeather.append(
        '<div class="border rounded-pill my-4" id="weatherIcon">' + todayIcon + '</div>' +
        '<h5 class="text-capitalize mb-3">' + desc + '</h5>' +
        '<h4 class="my-2 mx-2"><i class="me-2 bi bi-thermometer-half" style="color: #A26769;"></i> ' + tempCelsius + ' °C</h4>' +
        '<h4 class="my-2 mx-2"><i class="me-2 bi bi-wind" style="color: #41576b;"></i> ' + wind + ' km/h</h4>' +
        '<h4 class="my-2 mb-4 mx-2"><i class="me-2 bi bi-droplet-half" style="color: #99B2DD;"></i>' + humidity + ' %</h4>'
      );
    }).fail(function (jqXHR, textStatus) {
      showError("Weather API error: " + textStatus);
    });
  }

  // ============================================
  // 5-DAY FORECAST
  // ============================================
  function fetchForecast(city) {
    var queryURL = "https://api.openweathermap.org/data/2.5/forecast?q=" + encodeURIComponent(city) + "&units=metric&appid=" + apiKeyWeather;
    $.getJSON(queryURL, function (data) {
      $("#forecastContainer").empty();
      if (!data.list || data.list.length === 0) return;

      // Pick one forecast per day around noon (12:00)
      var daily = {};
      data.list.forEach(function (item) {
        var date = item.dt_txt.split(" ")[0];
        var hour = parseInt(item.dt_txt.split(" ")[1].split(":")[0], 10);
        if (!daily[date] || Math.abs(hour - 12) < Math.abs(daily[date].hour - 12)) {
          daily[date] = { item: item, hour: hour };
        }
      });

      var count = 0;
      Object.keys(daily).forEach(function (dateKey) {
        if (count >= 5) return;
        count++;
        var item = daily[dateKey].item;
        var dayName = dayjs(item.dt_txt).format("ddd");
        var icon = item.weather[0].icon;
        var temp = item.main.temp.toFixed(0);
        var iconUrl = "https://openweathermap.org/img/wn/" + icon + "@2x.png";

        $("#forecastContainer").append(
          '<div class="forecast-card">' +
            '<h6>' + dayName + '</h6>' +
            '<img src="' + iconUrl + '" alt="weather">' +
            '<p>' + temp + '°C</p>' +
          '</div>'
        );
      });
    }).fail(function () {
      console.error("Forecast API failed");
    });
  }

  // ============================================
  // SAVED PLACES (localStorage)
  // ============================================
  function getSavedPlaces() {
    return JSON.parse(localStorage.getItem("paws-saved-places") || "[]");
  }
  function setSavedPlaces(places) {
    localStorage.setItem("paws-saved-places", JSON.stringify(places));
  }
  function isPlaceSaved(id) {
    return getSavedPlaces().some(function (p) { return p.id === id; });
  }

  $(document).on("click", ".save-place-btn", function () {
    var btn = $(this);
    var card = btn.closest(".card");
    var id = btn.data("place-id");
    var saved = getSavedPlaces();
    var idx = saved.findIndex(function (p) { return p.id === id; });

    if (idx > -1) {
      saved.splice(idx, 1);
      btn.find("i").removeClass("bi-heart-fill text-danger").addClass("bi-heart");
      showToast("Removed from saved places", "info");
    } else {
      saved.push({
        id: id,
        name: card.data("name"),
        address: card.data("address"),
        lat: card.data("lat"),
        lon: card.data("lon"),
        savedAt: new Date().toISOString()
      });
      btn.find("i").removeClass("bi-heart").addClass("bi-heart-fill text-danger");
      showToast("Saved to your favorites!", "success");
    }
    setSavedPlaces(saved);
    renderSavedPlaces();
  });

  // Saved Places Modal
  var savedPlacesModal = new bootstrap.Modal($("#savedPlacesModal"));
  $("#savedPlacesBtn").on("click", function (e) {
    e.preventDefault();
    renderSavedPlaces();
    savedPlacesModal.show();
  });

  function renderSavedPlaces() {
    var container = $("#savedPlacesContainer");
    var empty = $("#noSavedPlaces");
    container.empty();
    var saved = getSavedPlaces();
    if (saved.length === 0) {
      empty.removeClass("d-none");
      return;
    }
    empty.addClass("d-none");
    saved.forEach(function (place) {
      container.append(
        '<div class="saved-place-item d-flex justify-content-between align-items-center">' +
          '<div>' +
            '<h6 class="mb-1">' + escapeHtml(place.name) + '</h6>' +
            '<p class="mb-0 text-muted monoText"><i class="bi bi-geo-alt me-1"></i>' + escapeHtml(place.address) + '</p>' +
          '</div>' +
          '<div class="d-flex gap-2">' +
            '<button class="btn btn-sm btn-outline-primary view-saved-btn" data-lat="' + place.lat + '" data-lon="' + place.lon + '" title="View on map"><i class="bi bi-map"></i></button>' +
            '<button class="btn btn-sm btn-outline-danger remove-saved-btn" data-place-id="' + place.id + '" title="Remove"><i class="bi bi-trash"></i></button>' +
          '</div>' +
        '</div>'
      );
    });
  }

  $(document).on("click", ".remove-saved-btn", function () {
    var id = $(this).data("place-id");
    var saved = getSavedPlaces().filter(function (p) { return p.id !== id; });
    setSavedPlaces(saved);
    renderSavedPlaces();
    // Also update any visible card buttons
    $('.save-place-btn[data-place-id="' + id + '"]').find("i").removeClass("bi-heart-fill text-danger").addClass("bi-heart");
  });

  $(document).on("click", ".view-saved-btn", function () {
    var lat = parseFloat($(this).data("lat"));
    var lon = parseFloat($(this).data("lon"));
    moveMapToLocation(lat, lon);
    addPinToMap(lat, lon, "Saved Place");
    savedPlacesModal.hide();
    window.location.href = "#navigationBar";
  });

  $("#clearSavedBtn").on("click", function () {
    setSavedPlaces([]);
    renderSavedPlaces();
    $(".save-place-btn i").removeClass("bi-heart-fill text-danger").addClass("bi-heart");
    showToast("All saved places cleared", "info");
  });

  // ============================================
  // DAY PLANNER / ITINERARY
  // ============================================
  function getPlan() {
    return JSON.parse(localStorage.getItem("paws-plan") || "[]");
  }
  function setPlan(plan) {
    localStorage.setItem("paws-plan", JSON.stringify(plan));
    updatePlanBadge();
  }
  function isPlacePlanned(id) {
    return getPlan().some(function (p) { return p.id === id; });
  }
  function updatePlanBadge() {
    var count = getPlan().length;
    var badge = $("#planCountBadge");
    badge.text(count);
    if (count > 0) badge.removeClass("d-none"); else badge.addClass("d-none");
  }
  updatePlanBadge();

  $(document).on("click", ".add-to-plan-btn", function () {
    var btn = $(this);
    var card = btn.closest(".card");
    var id = btn.data("place-id");
    var plan = getPlan();
    var idx = plan.findIndex(function (p) { return p.id === id; });

    if (idx > -1) {
      plan.splice(idx, 1);
      btn.find("i").removeClass("bi-calendar-check-fill text-success").addClass("bi-calendar-plus");
      showToast("Removed from plan", "info");
    } else {
      plan.push({
        id: id,
        name: card.data("name"),
        address: card.data("address"),
        lat: parseFloat(card.data("lat")),
        lon: parseFloat(card.data("lon"))
      });
      btn.find("i").removeClass("bi-calendar-plus").addClass("bi-calendar-check-fill text-success");
      showToast("Added to your day plan!", "success");
    }
    setPlan(plan);
    renderPlan();
  });

  // Plan Panel
  var planPanel = new bootstrap.Offcanvas($("#myPlanPanel"));
  $("#myPlanBtn").on("click", function (e) {
    e.preventDefault();
    renderPlan();
    planPanel.show();
  });

  function renderPlan() {
    var list = $("#planList");
    var empty = $("#planEmptyState");
    var stats = $("#planStats");
    var plan = getPlan();

    if (plan.length === 0) {
      list.addClass("d-none");
      stats.addClass("d-none");
      empty.removeClass("d-none");
      return;
    }
    empty.addClass("d-none");
    list.removeClass("d-none");
    stats.removeClass("d-none");
    list.empty();

    var totalDist = 0;
    plan.forEach(function (place, index) {
      if (index > 0) {
        totalDist += haversine(plan[index - 1].lat, plan[index - 1].lon, place.lat, place.lon);
      }
      list.append(
        '<li class="list-group-item plan-item mb-2">' +
          '<div class="d-flex align-items-center gap-3">' +
            '<div class="plan-number">' + (index + 1) + '</div>' +
            '<div>' +
              '<h6 class="mb-1">' + escapeHtml(place.name) + '</h6>' +
              '<p class="mb-0 text-muted monoText"><i class="bi bi-geo-alt me-1"></i>' + escapeHtml(place.address) + '</p>' +
            '</div>' +
          '</div>' +
          '<button class="btn btn-sm btn-outline-danger remove-plan-btn" data-place-id="' + place.id + '" title="Remove"><i class="bi bi-x-lg"></i></button>' +
        '</li>'
      );
    });

    $("#planTotalPlaces").text("Places: " + plan.length);
    $("#planTotalDistance").text("Est. walking: " + totalDist.toFixed(1) + " km");
  }

  $(document).on("click", ".remove-plan-btn", function () {
    var id = $(this).data("place-id");
    var plan = getPlan().filter(function (p) { return p.id !== id; });
    setPlan(plan);
    renderPlan();
    $('.add-to-plan-btn[data-place-id="' + id + '"]').find("i").removeClass("bi-calendar-check-fill text-success").addClass("bi-calendar-plus");
  });

  $("#clearPlanBtn").on("click", function () {
    setPlan([]);
    renderPlan();
    $(".add-to-plan-btn i").removeClass("bi-calendar-check-fill text-success").addClass("bi-calendar-plus");
    showToast("Plan cleared", "info");
  });

  $("#sharePlanBtn").on("click", function () {
    var plan = getPlan();
    if (plan.length === 0) return;
    var text = "🐾 My Paws Planner Itinerary:\n\n";
    plan.forEach(function (p, i) {
      text += (i + 1) + ". " + p.name + " - " + p.address + "\n";
    });
    if (navigator.share) {
      navigator.share({ title: "My Paws Planner Itinerary", text: text });
    } else {
      navigator.clipboard.writeText(text).then(function () {
        showToast("Itinerary copied to clipboard!", "success");
      });
    }
  });

  // Haversine distance in km
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================
  function showToast(message, type) {
    type = type || "info";
    var iconMap = { success: "bi-check-circle-fill", danger: "bi-x-circle-fill", warning: "bi-exclamation-triangle-fill", info: "bi-info-circle-fill" };
    var icon = iconMap[type] || iconMap.info;
    var toastId = "toast-" + Date.now();
    var toastHtml =
      '<div id="' + toastId + '" class="toast align-items-center text-bg-' + type + ' border-0" role="alert" aria-live="assertive" aria-atomic="true">' +
        '<div class="d-flex">' +
          '<div class="toast-body"><i class="bi ' + icon + ' me-2"></i>' + message + '</div>' +
          '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
        '</div>' +
      '</div>';
    $("#toastContainer").append(toastHtml);
    var toast = new bootstrap.Toast($("#" + toastId), { delay: 3000 });
    toast.show();
    $("#" + toastId).on("hidden.bs.toast", function () { $(this).remove(); });
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================
  $("#searchButton").on("click", function () {
    var location = $("#locationInput").val();
    fetchData(location);
    window.location.href = "#navigationBar";
    $(".customNav").removeClass("d-none");
    $(".weatherContainer").removeClass("d-none");
    $(".activitiesContainer").removeClass("d-none");
    setTimeout(function () { if (map) map.invalidateSize(); }, 300);
  });

  $("#locationInput").on("keypress", function (e) {
    if (e.which === 13) $("#searchButton").trigger("click");
  });

  // ============================================
  // WELCOME MODAL
  // ============================================
  var shouldShowModal = localStorage.getItem("showModal");
  if (shouldShowModal !== "false") {
    var welcomeModal = new bootstrap.Modal($("#PawsPlannerModal"), { backdrop: "static" });
    welcomeModal.show();
  }
  $("#letsGetStartedBtn").on("click", function () {
    localStorage.setItem("showModal", "false");
    var welcomeModal = bootstrap.Modal.getInstance($("#PawsPlannerModal"));
    if (welcomeModal) welcomeModal.hide();
  });
});
