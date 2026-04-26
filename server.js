const { PeerServer } = require('peer')
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.get('/', (req, res) => res.send('PeerJS Server Running'))

const server = app.listen(process.env.PORT || 9000, () => {
  console.log('Server running on port', process.env.PORT || 9000)
})

PeerServer({ server, path: '/peerjs', allow_discovery: true })
