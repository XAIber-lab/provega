from flask import Flask
from flask_socketio import SocketIO
import random
import math
import eventlet

eventlet.monkey_patch()  # required for Socket.IO support with eventlet

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins='*')

# Cluster trends
cluster_trends = [
    {'clusterID': 'Cluster-0', 'base': 50,  'spikeRange': (10, 20)},
    {'clusterID': 'Cluster-1', 'base': 30,  'spikeRange': (5, 15)},
    {'clusterID': 'Cluster-2', 'base': 10,  'spikeRange': (2, 8)},
]

categories = ['A', 'B', 'C']

# Initialize lines
lines = []
for ct in cluster_trends:
    for cat in categories:
        lines.append({
            'id': f"{ct['clusterID']}-{cat}",
            'clusterID': ct['clusterID'],
            'category': cat,
            'base': ct['base'],
            'spikeRange': ct['spikeRange'],
            'y': ct['base'] + (random.uniform(-3, 3))
        })

global_x = 0
SPIKE_PROBABILITY = 0.05

def rand_between(min_val, max_val):
    return random.uniform(min_val, max_val)

def decay_factor(x, start_decay_x=200, min_decay=0.2):
    f = 1 - min(x / start_decay_x, 1) * (1 - min_decay)
    return max(f, min_decay)

@socketio.on('connect')
def handle_connect():
    global global_x
    print('Client connected')

    def send_data(app):
        global global_x
        with(app.app_context()):
            while True:
                x_value = global_x
                global_x += 1

                points = []
                for line in lines:
                    drift_strength = 0.005
                    drift = (line['base'] - line['y']) * drift_strength
                    noise = rand_between(-10, 10)
                    line['y'] += drift + noise

                    if line['clusterID'] == 'Cluster-1':
                        if x_value < 5:
                            mega = rand_between(100, 150)
                            line['y'] += mega
                        elif random.random() < SPIKE_PROBABILITY:
                            decay = decay_factor(x_value, 500, 0.1)
                            min_s, max_s = line['spikeRange']
                            spike = rand_between(min_s, max_s) / decay
                            line['y'] += spike
                    elif line['clusterID'] == 'Cluster-2':
                        if random.random() < SPIKE_PROBABILITY * 0.5:
                            min_s, max_s = line['spikeRange']
                            spike = rand_between(min_s, max_s)
                            line['y'] += spike
                    elif line['clusterID'] == 'Cluster-0':
                        if random.random() < SPIKE_PROBABILITY * 1.2:
                            osc = (math.sin(x_value / 100) + 1) / 2
                            min_s, max_s = 20, 60
                            spike = rand_between(min_s, max_s) * osc
                            line['y'] += spike

                    point = {
                        'x': x_value,
                        'y': round(line['y']),
                        'clusterID': line['clusterID'],
                        'category': line['category']
                    }
                    points.append(point)

                for point in points:
                    socketio.emit('data', point)
                socketio.sleep(0.5)  # pausa 500 ms

    socketio.start_background_task(send_data, app)

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=3000)
