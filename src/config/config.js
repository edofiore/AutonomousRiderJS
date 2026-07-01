const config = {
    host: process.env.DELIVEROO_HOST ?? "http://localhost:4001",
    // host: "https://deliveroojs.onrender.com",
    // host: "http://rtibdi.disi.unitn:8080",
    // host: "https://deliveroojs25.azurewebsites.net/?name=edo",
    // host: "https://deliveroojs25.azurewebsites.net/",
    // host: "https://deliveroojs.azurewebsites.net/",

    // edo - localhost
    // token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjA4NWZiZiIsIm5hbWUiOiJlZG8iLCJyb2xlIjoidXNlciIsImlhdCI6MTc0Nzg0NzU3NX0.sk9xzx3XvVgYxYM4sihRIrryYVOL8q45-WC9o_eKFZQ'

    // name: edo
    // token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjE5ODA2ZiIsIm5hbWUiOiJlZG8iLCJ0ZWFtSWQiOiJjOGMzMTciLCJ0ZWFtTmFtZSI6ImVkby1sZW8iLCJyb2xlIjoidXNlciIsImlhdCI6MTc0NTkyMTQ5M30.d1djDI98CpBDlOhowwWgB96ERLR5xZWkHCZ_hlbmePE'
    
    // name: leo
    // token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjA2MDQ1NiIsIm5hbWUiOiJsZW8iLCJ0ZWFtSWQiOiI3OGM3YjQiLCJ0ZWFtTmFtZSI6ImVkby1sZW8iLCJyb2xlIjoidXNlciIsImlhdCI6MTc0NzA2MDkxOH0.dDwkuVMQ2IXyFB15otsCRxYpaiCWx6J-PhG5MvtJnXk'
    // token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImI1NjA3MCIsIm5hbWUiOiJsZW8iLCJyb2xlIjoidXNlciIsImlhdCI6MTc3MTQzNzA0M30.wKI7xGQMcLATYCfumIGJDPWuohYoL6pEzI1HDsa3Wcs'
    token: process.env.DELIVEROO_TOKEN ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImY2ZTE3YSIsIm5hbWUiOiJsZW8iLCJ0ZWFtSWQiOiIwNmVlZWUiLCJ0ZWFtTmFtZSI6ImVkb2xlbyIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzc0MzY5Njc0fQ.FAKV0TvqwNVQyBPInFqvnNNbJJU2ZGPsBtz_4lgmzfg',

    // Multi-agent (Part 2) team coordination.
    team: {
        // Coordination is active only when enabled AND a teammate is discovered.
        // When disabled the agent behaves exactly as the single-agent (Part 1).
        enabled: (process.env.TEAM ?? '0') !== '0',
        // Shared secret both teammates use to recognise each other over the
        // (globally broadcast) Deliveroo message bus. Both agents must share it.
        secret: process.env.TEAM_SECRET ?? 'edoleo-team-secret',
    }
}

export default config;