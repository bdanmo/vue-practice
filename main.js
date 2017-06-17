//var greeter = new Vue

Vue.component('random-num', {
  template: `<button @click="injectRandomNum">{{number}}</button>`,
  data: function() {
    return {
      number: "Get Random!"
      //you could add more key/value pairs here
    }
  },
  methods: {
    injectRandomNum: function () {
      var n = Math.floor(Math.random() * 69 + 1);
      this.number = n;
    }
  }
})

const vm = new Vue({
  el: "#app",
  data: {
    counter: 0,
    title: "Hello Vue!",
    message: "1st Message",
    messageHistory: [],
    hasHistory: false
  },
  methods: {
    submit: function (event) {
      var input = event.target;
      vm.message = input.value;
      input.value = "";
    }
  },
  watch: {
    "message": function (newVal, oldVal) {
      //update a change-log list
      vm.messageHistory.unshift(oldVal);
      if (vm.messageHistory.length > 3) vm.messageHistory.pop();
      vm.hasHistory = true;
    }
  }
})

/*
vm.$watch("message", (newVal, oldVal) => {
  //update a change-log list
  vm.messageHistory.push(oldVal);
  vm.hasHistory = true;
});
*/
