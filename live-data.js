// ======================================================
// TRAVEL EXPLORER - LIVE DATA ENGINE V3
// Meteo + vento + mare + cache offline recente
// Fonte: Open-Meteo
// ======================================================

window.TravelLive = (() => {

    const WEATHER_URL =
        "https://api.open-meteo.com/v1/forecast";

    const MARINE_URL =
        "https://marine-api.open-meteo.com/v1/marine";

    const TIMEZONE =
        "Indian/Mauritius";

    const CACHE_TTL_MS =
        20 * 60 * 1000;

    const STALE_CACHE_MAX_MS =
        6 * 60 * 60 * 1000;


    function roundCoord(value) {

        return Number(value)
            .toFixed(3);

    }


    function cacheKey(
        type,
        lat,
        lon
    ) {

        return (
            "travel-live-" +
            type +
            "-" +
            roundCoord(lat) +
            "-" +
            roundCoord(lon)
        );

    }


    function readCache(key) {

        try {

            const raw =
                localStorage.getItem(
                    key
                );

            if (!raw) {
                return null;
            }

            return JSON.parse(raw);

        }

        catch (_) {
            return null;
        }

    }


    function writeCache(
        key,
        data
    ) {

        try {

            localStorage.setItem(
                key,
                JSON.stringify({
                    saved_at:
                        Date.now(),
                    data
                })
            );

        }

        catch (_) {
            // Cache non essenziale.
        }

    }


    async function fetchCached(
        url,
        key
    ) {

        const cached =
            readCache(key);

        if (
            cached &&
            (
                Date.now() -
                cached.saved_at
            ) < CACHE_TTL_MS
        ) {

            return {
                data:
                    cached.data,
                stale:
                    false,
                cached:
                    true
            };

        }

        try {

            const response =
                await fetch(
                    url,
                    {
                        cache:
                            "no-store"
                    }
                );

            if (!response.ok) {

                throw new Error(
                    "HTTP " +
                    response.status
                );

            }

            const data =
                await response.json();

            writeCache(
                key,
                data
            );

            return {
                data,
                stale:
                    false,
                cached:
                    false
            };

        }

        catch (error) {

            if (
                cached &&
                (
                    Date.now() -
                    cached.saved_at
                ) <
                STALE_CACHE_MAX_MS
            ) {

                return {
                    data:
                        cached.data,
                    stale:
                        true,
                    cached:
                        true
                };

            }

            throw error;

        }

    }


    async function getWeather(
        lat,
        lon
    ) {

        const params =
            new URLSearchParams({
                latitude:
                    String(lat),
                longitude:
                    String(lon),
                current:
                    [
                        "temperature_2m",
                        "apparent_temperature",
                        "precipitation",
                        "weather_code",
                        "cloud_cover",
                        "wind_speed_10m",
                        "wind_direction_10m",
                        "wind_gusts_10m"
                    ].join(","),
                hourly:
                    [
                        "temperature_2m",
                        "precipitation_probability",
                        "precipitation",
                        "weather_code",
                        "wind_speed_10m",
                        "wind_gusts_10m"
                    ].join(","),
                daily:
                    [
                        "weather_code",
                        "temperature_2m_max",
                        "temperature_2m_min",
                        "precipitation_probability_max",
                        "wind_speed_10m_max",
                        "wind_gusts_10m_max",
                        "sunrise",
                        "sunset"
                    ].join(","),
                timezone:
                    TIMEZONE,
                forecast_days:
                    "16"
            });

        return fetchCached(
            WEATHER_URL +
            "?" +
            params.toString(),
            cacheKey(
                "weather",
                lat,
                lon
            )
        );

    }


    async function getMarine(
        lat,
        lon
    ) {

        const params =
            new URLSearchParams({
                latitude:
                    String(lat),
                longitude:
                    String(lon),
                current:
                    [
                        "wave_height",
                        "wave_direction",
                        "wave_period",
                        "wind_wave_height",
                        "swell_wave_height",
                        "sea_surface_temperature"
                    ].join(","),
                daily:
                    [
                        "wave_height_max",
                        "wave_period_max",
                        "wind_wave_height_max",
                        "swell_wave_height_max"
                    ].join(","),
                timezone:
                    TIMEZONE,
                forecast_days:
                    "16",
                cell_selection:
                    "sea"
            });

        return fetchCached(
            MARINE_URL +
            "?" +
            params.toString(),
            cacheKey(
                "marine",
                lat,
                lon
            )
        );

    }


    function findDaily(
        data,
        date
    ) {

        if (
            !data ||
            !data.daily ||
            !Array.isArray(
                data.daily.time
            )
        ) {
            return null;
        }

        const index =
            data.daily.time
                .indexOf(date);

        if (index < 0) {
            return null;
        }

        const result = {
            date
        };

        Object
            .entries(
                data.daily
            )
            .forEach(
                ([key, values]) => {

                    if (
                        key !== "time" &&
                        Array.isArray(
                            values
                        )
                    ) {

                        result[key] =
                            values[index];

                    }

                }
            );

        return result;

    }


    function mauritiusDateISO() {

        const parts =
            new Intl
                .DateTimeFormat(
                    "en-GB",
                    {
                        timeZone:
                            TIMEZONE,
                        year:
                            "numeric",
                        month:
                            "2-digit",
                        day:
                            "2-digit"
                    }
                )
                .formatToParts(
                    new Date()
                );

        const map = {};

        parts.forEach(
            part => {
                map[part.type] =
                    part.value;
            }
        );

        return (
            map.year +
            "-" +
            map.month +
            "-" +
            map.day
        );

    }


    function mauritiusMinutesNow() {

        const parts =
            new Intl
                .DateTimeFormat(
                    "en-GB",
                    {
                        timeZone:
                            TIMEZONE,
                        hour:
                            "2-digit",
                        minute:
                            "2-digit",
                        hourCycle:
                            "h23"
                    }
                )
                .formatToParts(
                    new Date()
                );

        const map = {};

        parts.forEach(
            part => {
                map[part.type] =
                    part.value;
            }
        );

        return (
            Number(map.hour) *
            60 +
            Number(map.minute)
        );

    }


    function hourlyCurrentProbability(
        data
    ) {

        if (
            !data?.hourly?.time ||
            !data?.hourly
                ?.precipitation_probability
        ) {
            return null;
        }

        const now =
            new Date();

        const nowMauritius =
            new Intl.DateTimeFormat(
                "sv-SE",
                {
                    timeZone:
                        TIMEZONE,
                    year:
                        "numeric",
                    month:
                        "2-digit",
                    day:
                        "2-digit",
                    hour:
                        "2-digit",
                    hourCycle:
                        "h23"
                }
            )
            .format(now)
            .replace(" ", "T") +
            ":00";

        let index =
            data.hourly.time
                .indexOf(
                    nowMauritius
                );

        if (index < 0) {

            const today =
                mauritiusDateISO();

            index =
                data.hourly.time
                    .findIndex(
                        value =>
                            value.startsWith(
                                today
                            )
                    );

        }

        return index >= 0
            ? data.hourly
                .precipitation_probability[
                    index
                ]
            : null;

    }


    function assess(
        weather,
        marine = null
    ) {

        const wind =
            Number(
                weather?.wind_speed ??
                weather
                    ?.wind_speed_10m ??
                0
            );

        const gust =
            Number(
                weather?.wind_gusts ??
                weather
                    ?.wind_gusts_10m ??
                0
            );

        const rainProbability =
            Number(
                weather
                    ?.precipitation_probability ??
                0
            );

        const precipitation =
            Number(
                weather?.precipitation ??
                0
            );

        const weatherCode =
            Number(
                weather?.weather_code ??
                0
            );

        const wave =
            Number(
                marine?.wave_height ??
                marine?.wave_height_max ??
                0
            );

        const windWave =
            Number(
                marine
                    ?.wind_wave_height ??
                marine
                    ?.wind_wave_height_max ??
                0
            );

        const swell =
            Number(
                marine
                    ?.swell_wave_height ??
                marine
                    ?.swell_wave_height_max ??
                0
            );

        const badWind =
            wind >= 32 ||
            gust >= 48;

        const severeWind =
            wind >= 42 ||
            gust >= 60;

        const badRain =
            rainProbability >= 65 ||
            precipitation >= 2 ||
            weatherCode >= 80;

        const storm =
            weatherCode >= 95;

        const badSea =
            wave >= 1.5 ||
            windWave >= 1.2 ||
            swell >= 1.4;

        let score = 100;

        if (badWind) {
            score -= 22;
        }

        if (severeWind) {
            score -= 15;
        }

        if (badRain) {
            score -= 24;
        }

        if (storm) {
            score -= 25;
        }

        if (badSea) {
            score -= 24;
        }

        score =
            Math.max(
                0,
                Math.min(
                    100,
                    score
                )
            );

        let condition =
            "good";

        if (score < 45) {
            condition =
                "poor";
        }

        else if (
            score < 75
        ) {
            condition =
                "mixed";
        }

        const reasons = [];

        if (badRain) {
            reasons.push(
                "pioggia probabile"
            );
        }

        if (badWind) {
            reasons.push(
                "vento sostenuto"
            );
        }

        if (badSea) {
            reasons.push(
                "mare mosso"
            );
        }

        if (storm) {
            reasons.push(
                "temporali possibili"
            );
        }

        if (!reasons.length) {
            reasons.push(
                "condizioni generalmente favorevoli"
            );
        }

        return {
            score,
            condition,
            badWind,
            severeWind,
            badRain,
            badSea,
            storm,
            reasons
        };

    }


    async function getDaySnapshot(
        lat,
        lon,
        date,
        options = {}
    ) {

        const weatherResult =
            await getWeather(
                lat,
                lon
            );

        const weatherDay =
            findDaily(
                weatherResult.data,
                date
            );

        if (!weatherDay) {

            return {
                available:
                    false,
                reason:
                    "outside_horizon",
                date,
                stale:
                    weatherResult.stale
            };

        }

        let marineResult =
            null;

        let marineDay =
            null;

        if (
            options.includeMarine
        ) {

            try {

                marineResult =
                    await getMarine(
                        lat,
                        lon
                    );

                marineDay =
                    findDaily(
                        marineResult.data,
                        date
                    );

            }

            catch (_) {
                marineResult = null;
            }

        }

        const weatherForAssessment = {
            weather_code:
                weatherDay.weather_code,
            precipitation_probability:
                weatherDay
                    .precipitation_probability_max,
            wind_speed:
                weatherDay
                    .wind_speed_10m_max,
            wind_gusts:
                weatherDay
                    .wind_gusts_10m_max
        };

        const marineForAssessment =
            marineDay
                ? {
                    wave_height:
                        marineDay
                            .wave_height_max,
                    wind_wave_height:
                        marineDay
                            .wind_wave_height_max,
                    swell_wave_height:
                        marineDay
                            .swell_wave_height_max
                }
                : null;

        return {
            available:
                true,
            date,
            weather:
                weatherDay,
            marine:
                marineDay,
            assessment:
                assess(
                    weatherForAssessment,
                    marineForAssessment
                ),
            stale:
                Boolean(
                    weatherResult.stale ||
                    marineResult?.stale
                )
        };

    }


    async function getNowSnapshot(
        lat,
        lon,
        options = {}
    ) {

        const weatherResult =
            await getWeather(
                lat,
                lon
            );

        let marineResult =
            null;

        if (
            options.includeMarine !==
            false
        ) {

            try {

                marineResult =
                    await getMarine(
                        lat,
                        lon
                    );

            }

            catch (_) {
                marineResult = null;
            }

        }

        const currentWeather =
            weatherResult
                .data
                .current || {};

        const probability =
            hourlyCurrentProbability(
                weatherResult.data
            );

        const weatherForAssessment = {
            ...currentWeather,
            precipitation_probability:
                probability
        };

        const currentMarine =
            marineResult
                ?.data
                ?.current ||
            null;

        return {
            available:
                true,
            current:
                currentWeather,
            precipitation_probability:
                probability,
            marine:
                currentMarine,
            assessment:
                assess(
                    weatherForAssessment,
                    currentMarine
                ),
            stale:
                Boolean(
                    weatherResult.stale ||
                    marineResult?.stale
                ),
            date:
                mauritiusDateISO()
        };

    }


    function weatherCodeLabel(
        code
    ) {

        const value =
            Number(code);

        if (value === 0) {
            return "Sereno";
        }

        if (
            [1, 2].includes(value)
        ) {
            return "Poco/parzialmente nuvoloso";
        }

        if (value === 3) {
            return "Coperto";
        }

        if (
            [45, 48].includes(value)
        ) {
            return "Nebbia";
        }

        if (
            value >= 51 &&
            value <= 57
        ) {
            return "Pioviggine";
        }

        if (
            value >= 61 &&
            value <= 67
        ) {
            return "Pioggia";
        }

        if (
            value >= 71 &&
            value <= 77
        ) {
            return "Neve";
        }

        if (
            value >= 80 &&
            value <= 82
        ) {
            return "Rovesci";
        }

        if (
            value >= 95
        ) {
            return "Temporale";
        }

        return "Variabile";

    }


    function timeOnly(
        isoValue
    ) {

        if (!isoValue) {
            return "—";
        }

        const value =
            String(isoValue);

        return value.includes("T")
            ? value.split("T")[1]
            : value;

    }


    return {
        getWeather,
        getMarine,
        getDaySnapshot,
        getNowSnapshot,
        assess,
        weatherCodeLabel,
        mauritiusDateISO,
        mauritiusMinutesNow,
        timeOnly,
        TIMEZONE
    };

})();