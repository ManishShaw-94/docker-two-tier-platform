from flask import Flask, request, jsonify
from business import get_data

app = Flask(__name__)

@app.route('/')
def hello_world():
    return 'Hello World!'

@app.route('/api', methods=['GET'])
def api():
    data1 = get_data()

    data2 = {
        'data1' : data1
    }

    return jsonify(data2)

if __name__ == '__main__':
    app.run(port=8000, host='0.0.0.0', debug=True)